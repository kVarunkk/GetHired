import type { SupabaseClient } from "@supabase/supabase-js";
import { RESUME_SECTION_LABELS } from "@/helpers/resume/config";
import { buildResumeDocument, type ResumeDocument } from "@/helpers/resume/render/document";
import { previewReviewSuggestions } from "@/helpers/resume-review/apply-suggestions";
import type { ReviewChange } from "@/helpers/resume-review/changes";
import type { Database } from "@/utils/types/database.types";
import { RESUME_DEFAULT_NAME, ResumeFromChatSchema } from "./create-resume";
import { LAST_RESUME_ERROR } from "./delete-resume";
import { describeResumeChanges, type ResumeChange } from "./resume-changes";
import { RESUME_LIMIT_ERROR, hasRoomForResume } from "./resume-limit";
import { planResumeUpdate } from "./update-resume";

export const RESUME_EDIT_TOOLS = ["createResume", "updateResume", "deleteResume", "applyReviewSuggestions"] as const;
export type ResumeEditTool = (typeof RESUME_EDIT_TOOLS)[number];

/**
 * `before` and `after` hold contact details, so they go only to the resume's
 * owner, through the approval card. MCP reads `summary` and `changes` alone
 * (RI-REQ-003, RI-SEC-004).
 */
export type ResumeEditPreview =
  | { ok: true; summary: string; changes: ResumeChange[]; before?: ResumeDocument; after?: ResumeDocument }
  | { ok: false; error: string };

type Client = SupabaseClient<Database>;
type User = { id: string };

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CHANGE_LABELS: Record<ReviewChange["kind"], string> = {
  rewrite: "Bullet",
  add: "New bullet",
  remove: "Removed bullet",
  move: "Order",
};

async function previewUpdate(supabase: Client, user: User, input: unknown): Promise<ResumeEditPreview> {
  const plan = await planResumeUpdate(supabase, user, input);
  if (!plan.ok) return { ok: false, error: plan.error };

  const changes = describeResumeChanges(plan.before, plan.after);
  if (changes.length === 0) return { ok: false, error: "These changes wouldn't change anything." };
  return {
    ok: true,
    summary: `Change "${plan.before.name}"?`,
    changes,
    before: buildResumeDocument(plan.before),
    after: buildResumeDocument(plan.after),
  };
}

async function previewCreate(supabase: Client, user: User, input: unknown): Promise<ResumeEditPreview> {
  const parsed = ResumeFromChatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "This resume isn't valid." };
  if (!(await hasRoomForResume(supabase, user.id))) return { ok: false, error: RESUME_LIMIT_ERROR };

  const { name, sections } = parsed.data;
  const summary = `Create the resume "${name?.trim() || RESUME_DEFAULT_NAME}"?`;
  if (!sections) return { ok: true, summary, changes: [] };

  const after = sections.map((section) => section.title || RESUME_SECTION_LABELS[section.type]).join(", ");
  return { ok: true, summary, changes: [{ label: "Sections", before: "", after }] };
}

async function previewDelete(supabase: Client, user: User, input: unknown): Promise<ResumeEditPreview> {
  const resumeId = (input as { resumeId?: unknown } | null)?.resumeId;
  if (typeof resumeId !== "string") return { ok: false, error: "Resume not found." };

  const { data: resumes, error } = await supabase.from("resumes").select("id, name").eq("user_id", user.id);
  if (error) throw new Error(`Failed to read the resumes: ${error.message}`);

  const target = resumes?.find((resume) => resume.id === resumeId);
  if (!target) return { ok: false, error: "Resume not found." };
  if (resumes!.length === 1) return { ok: false, error: LAST_RESUME_ERROR };

  const { count: reviews, error: countError } = await supabase
    .from("resume_reviews")
    .select("id", { count: "exact", head: true })
    .eq("resume_id", resumeId);
  if (countError) throw new Error(`Failed to count the reviews: ${countError.message}`);

  const lost = reviews ? ` Its ${count(reviews, "review")} will be deleted too.` : "";
  return { ok: true, summary: `Delete "${target.name ?? RESUME_DEFAULT_NAME}"? This can't be undone.${lost}`, changes: [] };
}

async function previewApply(supabase: Client, user: User, input: unknown): Promise<ResumeEditPreview> {
  const preview = await previewReviewSuggestions(supabase, user, input);
  if (!preview.ok) return { ok: false, error: preview.error };
  if (preview.applied.length === 0) {
    return { ok: false, error: "Nothing to apply: these bullets have changed since the review." };
  }

  const where = preview.makesCopy
    ? `a new copy of "${preview.resumeName ?? RESUME_DEFAULT_NAME}"`
    : `"${preview.resumeName ?? RESUME_DEFAULT_NAME}"`;
  const skipped = preview.changedCount ? ` ${count(preview.changedCount, "bullet")} changed and will be skipped.` : "";
  return {
    ok: true,
    summary: `Apply ${count(preview.applied.length, "suggestion")} to ${where}?${skipped}`,
    changes: preview.applied.map(({ kind, previousText, appliedText }) => ({
      label: CHANGE_LABELS[kind],
      before: previousText,
      after: kind === "move" ? "Moves to a new position" : appliedText,
    })),
    before: preview.before,
    after: preview.after,
  };
}

const PREVIEWS: Record<ResumeEditTool, (supabase: Client, user: User, input: unknown) => Promise<ResumeEditPreview>> = {
  createResume: previewCreate,
  updateResume: previewUpdate,
  deleteResume: previewDelete,
  applyReviewSuggestions: previewApply,
};

/**
 * What a resume tool would do, for the agent's approval card and MCP's
 * confirmation. It only reads. A call that would fail returns the error instead,
 * so the user isn't asked about something that can't happen.
 */
export function previewResumeEdit(supabase: Client, user: User, tool: ResumeEditTool, input: unknown) {
  return PREVIEWS[tool](supabase, user, input);
}
