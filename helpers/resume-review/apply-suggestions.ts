import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/utils/types/database.types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { sameBulletText } from "@/helpers/resume/carry-bullet-ids";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { readResume } from "@/helpers/resume/read-resume";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { duplicateResume } from "@/helpers/resumes/duplicate-resume";
import { RESUME_CHANGED, saveResume, type ResumeSurface } from "@/helpers/resumes/save-resume";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { PostHogEvent } from "@/utils/types";
import { hasPlaceholder, readSuggestions, resumeBullets } from "./suggestions";

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
        bulletId: z.string().min(1),
        text: z.string().trim().min(1, "A bullet can't be empty.").max(RESUME_LIMITS.bulletChars).optional(),
      }),
    )
    .min(1, "Choose a suggestion to apply."),
});

export type ApplySuggestionsInput = z.input<typeof ApplySuggestionsInputSchema>;
export type ApplyTarget = z.output<typeof ApplySuggestionsInputSchema>["target"];

export type ApplyItemStatus = "applied" | "changed" | "not_found";
export type ApplyItemResult = { bulletId: string; status: ApplyItemStatus };

type WriteFailure = { ok: false; code: "NOT_FOUND" | "INVALID" | "UPGRADE_FAILED" | typeof RESUME_CHANGED; error: string };

export type ApplySuggestionsResult =
  | { ok: true; target: ApplyTarget; targetResumeId: string | null; items: ApplyItemResult[] }
  | WriteFailure
  | { ok: false; code: "COPY_FAILED"; error: string }
  | { ok: false; code: typeof PLACEHOLDER_UNFILLED; error: string; bulletIds: string[] };

export type UndoSuggestionResult =
  | { ok: true; targetResumeId: string }
  | WriteFailure
  | { ok: false; code: "BULLET_CHANGED"; error: string };

export type PlannedChange = { bulletId: string; original: string; text: string };

export type AppliedChange = { bulletId: string; previousText: string; appliedText: string };

/**
 * Puts each change into `content`, only where the bullet still has the text the
 * suggestion was written for (RE-REQ-058). Pure, so a preview can use it too.
 */
export function replaceBullets(content: ResumeContent, changes: PlannedChange[]) {
  const planned = new Map(changes.map((change) => [change.bulletId, change]));
  const applied: AppliedChange[] = [];

  const next: ResumeContent = {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => {
          const change = planned.get(bullet.id);
          if (!change || !sameBulletText(bullet.text, change.original)) return bullet;
          applied.push({ bulletId: bullet.id, previousText: bullet.text, appliedText: change.text });
          return { ...bullet, text: change.text };
        }),
      })),
    })),
  };

  return { content: next, applied };
}

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

/** The review, and the changes it would make. Reads only, and refuses text with a placeholder. */
async function planChanges(supabase: SupabaseClient<Database>, user: { id: string }, input: unknown) {
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

  const suggestions = new Map(readSuggestions(review.ai_response).map((s) => [s.bullet_id, s]));
  const changes = items.flatMap(({ bulletId, text }): PlannedChange[] => {
    const suggestion = suggestions.get(bulletId);
    return suggestion ? [{ bulletId, original: suggestion.original, text: text ?? suggestion.suggested }] : [];
  });

  const unfilled = changes.filter((change) => hasPlaceholder(change.text)).map((change) => change.bulletId);
  if (unfilled.length > 0) {
    return {
      ok: false as const,
      code: PLACEHOLDER_UNFILLED,
      error: "Fill in the bracketed values with real ones first.",
      bulletIds: unfilled,
    };
  }

  if (!review.resume_id) return { ok: false as const, code: "NOT_FOUND" as const, error: RESUME_NOT_FOUND };

  return { ok: true as const, review: { ...review, resume_id: review.resume_id }, target, items, suggestions, changes };
}

export type ApplyPreview =
  | {
      ok: true;
      target: ApplyTarget;
      /** The resume the changes land on, or a new copy of it. */
      resumeName: string | null;
      makesCopy: boolean;
      applied: AppliedChange[];
      changedCount: number;
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
  const plan = await planChanges(supabase, user, input);
  if (!plan.ok) return plan;
  const { review, target, items, changes } = plan;

  const read = async (resumeId: string) => {
    const { data, error } = await fullResume(supabase, user.id, resumeId);
    if (error) throw new Error(`Failed to read the resume: ${error.message}`);
    return data;
  };

  const copy = target === "copy" && review.applied_copy_id ? await read(review.applied_copy_id) : null;
  const resume = copy ?? (await read(review.resume_id));
  if (!resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };

  const { applied } = replaceBullets(readResume(resume).content, changes);
  return {
    ok: true,
    target,
    resumeName: resume.name,
    makesCopy: target === "copy" && !copy,
    applied,
    changedCount: items.length - applied.length,
  };
}

/**
 * Applies a review's suggestions to one reused copy (the default) or to the
 * reviewed resume, for the page, the agent and MCP (RE-REQ-056). One call is one
 * `saveResume`. A bullet that no longer has the reviewed text is reported and
 * the rest still apply. Text with a placeholder refuses the whole call before
 * anything is written.
 */
export async function applyReviewSuggestions(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  input: ApplySuggestionsInput,
  { surface = "page" }: { surface?: ResumeSurface } = {},
): Promise<ApplySuggestionsResult> {
  const plan = await planChanges(supabase, user, input);
  if (!plan.ok) return plan;
  const { review, target, items, suggestions, changes } = plan;
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

  let replaced = replaceBullets(readResume(resume).content, changes);
  const report = (applied: AppliedChange[]) => {
    const done = new Set(applied.map((change) => change.bulletId));
    return items.map(({ bulletId }): ApplyItemResult => ({
      bulletId,
      status: done.has(bulletId) ? "applied" : suggestions.has(bulletId) ? "changed" : "not_found",
    }));
  };

  if (replaced.applied.length === 0) {
    return { ok: true, target, targetResumeId: null, items: report([]) };
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

    const loaded = await loadResume(supabase, user.id, copy.resumeId);
    if (!loaded.ok) return loaded;
    if (!loaded.resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };
    resume = loaded.resume;
    replaced = replaceBullets(readResume(resume).content, changes);
  }

  const saved = await saveContent(supabase, user, resume, replaced.content, surface);
  if (!saved.ok) return saved;

  const appliedAt = new Date().toISOString();
  const { error: recordError } = await supabase.from("resume_review_applied").upsert(
    replaced.applied.map((change) => ({
      review_id: reviewId,
      bullet_id: change.bulletId,
      target_resume_id: resume.id,
      previous_text: change.previousText,
      applied_text: change.appliedText,
      applied_at: appliedAt,
    })),
    { onConflict: "review_id,bullet_id,target_resume_id" },
  );
  // The resume is already saved: only Undo is lost.
  if (recordError) reportError("[REVIEW_APPLIED_RECORD_FAILED]:", recordError);

  const count = replaced.applied.length;
  after(() =>
    eventCaptureServer({
      event: PostHogEvent.ReviewSuggestionsApplied,
      distinctId: user.id,
      properties: { count, target, surface },
    }),
  );

  return { ok: true, target, targetResumeId: resume.id, items: report(replaced.applied) };
}

/**
 * Puts a bullet back, but only if it still has the applied text, so Undo never
 * overwrites an edit made since (RE-REQ-060).
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

  const loaded = await loadResume(supabase, user.id, targetResumeId);
  if (!loaded.ok) return loaded;
  if (!loaded.resume) return { ok: false, code: "NOT_FOUND", error: RESUME_NOT_FOUND };

  const content = readResume(loaded.resume).content;
  const bullet = resumeBullets(content).find((candidate) => candidate.id === bulletId);
  if (!bullet || bullet.text !== record.applied_text) {
    return { ok: false, code: "BULLET_CHANGED", error: "This bullet was edited after applying, so it wasn't undone." };
  }

  const restored = replaceBullets(content, [
    { bulletId, original: record.applied_text, text: record.previous_text },
  ]);
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
