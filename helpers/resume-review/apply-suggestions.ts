import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/utils/types/database.types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { readResume } from "@/helpers/resume/read-resume";
import { buildResumeDocument, type ResumeDocument } from "@/helpers/resume/render/document";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { duplicateResume } from "@/helpers/resumes/duplicate-resume";
import { applyResumeOperations } from "@/helpers/resumes/resume-operations";
import { RESUME_CHANGED, saveResume, type ResumeSurface } from "@/helpers/resumes/save-resume";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { PostHogEvent } from "@/utils/types";
import {
  changeText,
  planChangeOperations,
  readChanges,
  type ChosenChange,
  type PlannedChange,
} from "./changes";
import { hasPlaceholder, resumeBullets } from "./suggestions";

/** Text still holds a `[placeholder]` for the user to fill in (RE-REQ-059). */
export const PLACEHOLDER_UNFILLED = "PLACEHOLDER_UNFILLED" as const;

const REVIEW_NOT_FOUND = "Review not found.";
const RESUME_NOT_FOUND = "Resume not found.";
const NO_CONTACT = { fullName: "", links: [] };

export const ApplySuggestionsInputSchema = z.object({
  reviewId: z.string().uuid(),
  target: z.enum(["copy", "original"]).default("copy"),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().trim().min(1, "A bullet can't be empty.").max(RESUME_LIMITS.bulletChars).optional(),
      }),
    )
    .min(1, "Choose a suggestion to apply."),
});

export type ApplySuggestionsInput = z.input<typeof ApplySuggestionsInputSchema>;
export type ApplyTarget = z.output<typeof ApplySuggestionsInputSchema>["target"];

export type ApplyItemStatus = "applied" | "already_applied" | "changed" | "not_found";
export type ApplyItemResult = { id: string; status: ApplyItemStatus };

type WriteFailure = { ok: false; code: "NOT_FOUND" | "INVALID" | "UPGRADE_FAILED" | typeof RESUME_CHANGED; error: string };

export type ApplySuggestionsResult =
  | { ok: true; target: ApplyTarget; targetResumeId: string | null; items: ApplyItemResult[] }
  | WriteFailure
  | { ok: false; code: "COPY_FAILED"; error: string }
  | { ok: false; code: typeof PLACEHOLDER_UNFILLED; error: string; ids: string[] };

export type UndoSuggestionResult =
  | { ok: true; targetResumeId: string }
  | WriteFailure
  | { ok: false; code: "BULLET_CHANGED"; error: string };

const fullResume = (supabase: SupabaseClient<Database>, userId: string, resumeId: string) =>
  supabase
    .from("resumes")
    .select("id, name, content, contact, template, revision, schema_version, resume_path")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();

type ResumeRow = NonNullable<Awaited<ReturnType<typeof fullResume>>["data"]>;

type LoadedResume =
  | { ok: true; resume: ResumeRow | null }
  | { ok: false; code: "UPGRADE_FAILED"; error: string };

/** The resume as version 2, so a change never lands on text a re-parse replaces (RE-REQ-095). */
async function loadResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  resumeId: string,
): Promise<LoadedResume> {
  const { data, error } = await fullResume(supabase, userId, resumeId);
  if (error) throw new Error(`Failed to read the resume: ${error.message}`);
  if (data?.schema_version !== 1) return { ok: true, resume: data };

  const upgraded = await upgradeResumeFromFile(data);
  if (!upgraded.ok) return { ok: false, code: "UPGRADE_FAILED", error: upgraded.error };

  const { data: fresh, error: rereadError } = await fullResume(supabase, userId, resumeId);
  if (rereadError) throw new Error(`Failed to read the resume: ${rereadError.message}`);
  return { ok: true, resume: fresh };
}

const saveContent = (
  supabase: SupabaseClient<Database>,
  user: { id: string },
  resume: ResumeRow,
  content: ResumeContent,
  surface: ResumeSurface,
) => {
  const { contact, template, revision } = readResume(resume);
  return saveResume(
    supabase,
    user,
    {
      resumeId: resume.id,
      expectedRevision: revision,
      contact: contact ?? NO_CONTACT,
      content,
      name: resume.name ?? "Untitled resume",
      template,
    },
    { surface },
  );
};

const copyName = (resumeName: string | null, label: string | null | undefined) =>
  [resumeName ?? "Untitled resume", label].filter(Boolean).join(" – ").slice(0, RESUME_LIMITS.shortFieldChars);

/** The review, and the changes chosen from it. Reads only, and refuses text with a placeholder. */
async function loadChosen(supabase: SupabaseClient<Database>, user: { id: string }, input: unknown) {
  const parsed = ApplySuggestionsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: "INVALID" as const,
      error: parsed.error.issues[0]?.message ?? "Choose a suggestion to apply.",
    };
  }
  const { reviewId, target, items } = parsed.data;

  const { data: review, error: reviewError } = await supabase
    .from("resume_reviews")
    .select("id, name, resume_id, applied_copy_id, ai_response, all_jobs ( job_name )")
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (reviewError) throw new Error(`Failed to read the review: ${reviewError.message}`);
  if (!review) return { ok: false as const, code: "NOT_FOUND" as const, error: REVIEW_NOT_FOUND };

  const changes = new Map(readChanges(review.ai_response).map((change) => [change.id, change]));
  const chosen = items.flatMap(({ id, text }): ChosenChange[] => {
    const change = changes.get(id);
    return change ? [{ change, text }] : [];
  });

  const unfilled = chosen
    .filter(({ change, text }) => hasPlaceholder(changeText(change, text) ?? ""))
    .map(({ change }) => change.id);
  if (unfilled.length > 0) {
    return {
      ok: false as const,
      code: PLACEHOLDER_UNFILLED,
      error: "Fill in the bracketed values with real ones first.",
      ids: unfilled,
    };
  }

  if (!review.resume_id) return { ok: false as const, code: "NOT_FOUND" as const, error: RESUME_NOT_FOUND };

  return { ok: true as const, review: { ...review, resume_id: review.resume_id }, target, items, chosen };
}

/** The changes already on this resume, so re-applying can't add a bullet twice (RI-REQ-034). */
async function appliedIds(supabase: SupabaseClient<Database>, reviewId: string, resumeId: string) {
  const { data, error } = await supabase
    .from("resume_review_applied")
    .select("bullet_id")
    .eq("review_id", reviewId)
    .eq("target_resume_id", resumeId);
  if (error) throw new Error(`Failed to read the applied suggestions: ${error.message}`);
  return new Set((data ?? []).map((row) => row.bullet_id));
}

export type ApplyPreview =
  | {
      ok: true;
      target: ApplyTarget;
      /** The resume the changes land on, or a new copy of it. */
      resumeName: string | null;
      makesCopy: boolean;
      applied: PlannedChange[];
      changedCount: number;
      before: ResumeDocument;
      after: ResumeDocument;
    }
  | Exclude<ApplySuggestionsResult, { ok: true }>;

/**
 * What `applyReviewSuggestions` would do, with no side effects: a version 1
 * resume isn't upgraded here (RE-REQ-072, RE-REQ-082).
 */
export async function previewReviewSuggestions(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: unknown,
): Promise<ApplyPreview> {
  const loaded = await loadChosen(supabase, user, input);
  if (!loaded.ok) return loaded;
  const { review, target, items, chosen } = loaded;

  const read = async (resumeId: string) => {
    const { data, error } = await fullResume(supabase, user.id, resumeId);
    if (error) throw new Error(`Failed to read the resume: ${error.message}`);
    return data;
  };

  const copy = target === "copy" && review.applied_copy_id ? await read(review.applied_copy_id) : null;
  const resume = copy ?? (await read(review.resume_id));
  if (!resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };

  const makesCopy = target === "copy" && !copy;
  const done = makesCopy ? new Set<string>() : await appliedIds(supabase, review.id, resume.id);
  const { content, contact, template } = readResume(resume);
  const { operations, planned } = planChangeOperations(
    content,
    chosen.filter(({ change }) => !done.has(change.id)),
  );

  const result = applyResumeOperations(content, contact ?? NO_CONTACT, operations);
  if (!result.ok) return { ok: false, code: "INVALID", error: result.error };

  const applied = planned.filter((change) => change.status === "applied");
  const document = (next: ResumeContent) =>
    buildResumeDocument({ content: next, contact: contact ?? NO_CONTACT, template });
  return {
    ok: true,
    target,
    resumeName: resume.name,
    makesCopy,
    applied,
    changedCount: items.length - applied.length,
    before: document(content),
    after: document(result.content),
  };
}

/**
 * Applies a review's changes to one reused copy (the default) or to the reviewed
 * resume, for the page, the agent and MCP (RE-REQ-056, RI-REQ-030). One call is
 * one `saveResume`. A change the resume has moved past is reported and the rest
 * still apply. Text with a placeholder refuses the whole call before anything is
 * written.
 */
export async function applyReviewSuggestions(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: ApplySuggestionsInput,
  { surface = "page" }: { surface?: ResumeSurface } = {},
): Promise<ApplySuggestionsResult> {
  const loaded = await loadChosen(supabase, user, input);
  if (!loaded.ok) return loaded;
  const { review, target, items, chosen } = loaded;
  const reviewId = review.id;

  // The copy this review already made, or else the reviewed resume, which a new
  // copy starts from.
  const existingCopy =
    target === "copy" && review.applied_copy_id
      ? await loadResume(supabase, user.id, review.applied_copy_id)
      : null;
  if (existingCopy && !existingCopy.ok) return existingCopy;

  let resume = existingCopy?.resume ?? null;
  const needsCopy = target === "copy" && !resume;
  if (!resume) {
    const source = await loadResume(supabase, user.id, review.resume_id);
    if (!source.ok) return source;
    if (!source.resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };
    resume = source.resume;
  }

  const done = needsCopy ? new Set<string>() : await appliedIds(supabase, reviewId, resume.id);
  const open = chosen.filter(({ change }) => !done.has(change.id));
  let plan = planChangeOperations(readResume(resume).content, open);

  const report = (planned: PlannedChange[]) => {
    const statuses = new Map(planned.map((change) => [change.id, change.status]));
    return items.map(({ id }): ApplyItemResult => {
      if (done.has(id)) return { id, status: "already_applied" };
      return { id, status: statuses.get(id) ?? (chosen.some(({ change }) => change.id === id) ? "changed" : "not_found") };
    });
  };
  const appliedOf = (planned: PlannedChange[]) => planned.filter((change) => change.status === "applied");

  if (appliedOf(plan.planned).length === 0) {
    return { ok: true, target, targetResumeId: null, items: report(plan.planned) };
  }

  if (needsCopy) {
    const jobName = review.all_jobs?.job_name;
    const copy = await duplicateResume(supabase, user, {
      resumeId: resume.id,
      name: copyName(resume.name, jobName || review.name),
    });
    if (!copy.ok) return { ok: false, code: "COPY_FAILED", error: copy.error };

    const { error: linkError } = await supabase
      .from("resume_reviews")
      .update({ applied_copy_id: copy.resumeId })
      .eq("id", reviewId)
      .eq("user_id", user.id);
    if (linkError) reportError("[REVIEW_COPY_LINK_FAILED]:", linkError);

    const copied = await loadResume(supabase, user.id, copy.resumeId);
    if (!copied.ok) return copied;
    if (!copied.resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };
    resume = copied.resume;
    plan = planChangeOperations(readResume(resume).content, open);
  }

  const { content, contact } = readResume(resume);
  const result = applyResumeOperations(content, contact ?? NO_CONTACT, plan.operations);
  if (!result.ok) return { ok: false, code: "INVALID", error: result.error };

  const saved = await saveContent(supabase, user, resume, result.content, surface);
  if (!saved.ok) return saved;

  const applied = appliedOf(plan.planned);
  const appliedAt = new Date().toISOString();
  const { error: recordError } = await supabase.from("resume_review_applied").upsert(
    applied.map((change) => ({
      review_id: reviewId,
      bullet_id: change.id,
      target_resume_id: resume.id,
      previous_text: change.previousText,
      applied_text: change.appliedText,
      applied_at: appliedAt,
    })),
    { onConflict: "review_id,bullet_id,target_resume_id" },
  );
  // The resume is already saved: only Undo is lost.
  if (recordError) reportError("[REVIEW_APPLIED_RECORD_FAILED]:", recordError);

  const kindCounts: Record<string, number> = {};
  for (const { kind } of applied) kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
  after(() =>
    eventCaptureServer({
      event: PostHogEvent.ReviewSuggestionsApplied,
      distinctId: user.id,
      properties: {
        count: applied.length,
        applied: applied.length,
        skipped: items.length - applied.length,
        kind_counts: kindCounts,
        target,
        surface,
      },
    }),
  );

  return { ok: true, target, targetResumeId: resume.id, items: report(plan.planned) };
}

/**
 * Puts a bullet back, but only if it still has the applied text, so Undo never
 * overwrites an edit made since (RE-REQ-060). Only a rewrite has text to put
 * back: an add's record has no `previous_text`, and a removal or a move has no
 * `applied_text` (RI-REQ-036).
 */
export async function undoReviewSuggestion(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  {
    reviewId,
    bulletId,
    targetResumeId,
  }: { reviewId: string; bulletId: string; targetResumeId: string },
  { surface = "page" }: { surface?: ResumeSurface } = {},
): Promise<UndoSuggestionResult> {
  const { data: review, error: reviewError } = await supabase
    .from("resume_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (reviewError) throw new Error(`Failed to read the review: ${reviewError.message}`);
  if (!review) return { ok: false, code: "NOT_FOUND", error: REVIEW_NOT_FOUND };

  const { data: record, error: recordError } = await supabase
    .from("resume_review_applied")
    .select("previous_text, applied_text")
    .eq("review_id", reviewId)
    .eq("bullet_id", bulletId)
    .eq("target_resume_id", targetResumeId)
    .maybeSingle();
  if (recordError) throw new Error(`Failed to read the applied suggestion: ${recordError.message}`);
  if (!record) return { ok: false, code: "NOT_FOUND", error: "That suggestion isn't applied." };
  if (!record.previous_text || !record.applied_text) {
    return { ok: false, code: "INVALID", error: "Only a rewrite can be undone." };
  }

  const loaded = await loadResume(supabase, user.id, targetResumeId);
  if (!loaded.ok) return loaded;
  if (!loaded.resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };

  const { content, contact } = readResume(loaded.resume);
  const bullet = resumeBullets(content).find((candidate) => candidate.id === bulletId);
  if (!bullet || bullet.text !== record.applied_text) {
    return { ok: false, code: "BULLET_CHANGED", error: "This bullet was edited after applying, so it wasn't undone." };
  }

  const restored = applyResumeOperations(content, contact ?? NO_CONTACT, [
    { op: "setBulletText", bulletId, text: record.previous_text },
  ]);
  if (!restored.ok) return { ok: false, code: "INVALID", error: restored.error };

  const saved = await saveContent(supabase, user, loaded.resume, restored.content, surface);
  if (!saved.ok) return saved;

  const { error: removeError } = await supabase
    .from("resume_review_applied")
    .delete()
    .eq("review_id", reviewId)
    .eq("bullet_id", bulletId)
    .eq("target_resume_id", targetResumeId);
  if (removeError) reportError("[REVIEW_APPLIED_REMOVE_FAILED]:", removeError);

  return { ok: true, targetResumeId };
}
