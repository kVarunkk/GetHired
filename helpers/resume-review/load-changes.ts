import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResumeTemplate } from "@/helpers/resume/config";
import { readResume } from "@/helpers/resume/read-resume";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import type { Database } from "@/utils/types/database.types";
import { planChangeOperations, readChanges, readGaps, type ReviewChange, type ReviewGap } from "./changes";
import { reviewTarget, type ReviewTarget } from "./target";

export type ChangeState = "pending" | "applied" | "changed";

/** What a change really did. It can differ from the suggestion, since the user can edit it. */
export type AppliedChange = { previous: string; text: string };

/** Where changes can land, with what each change would do there. */
export type ChangesTarget = {
  /** null: no copy yet. One is made on Apply, from the original (RI-REQ-028). */
  resumeId: string | null;
  content: ResumeContent;
  contact: ResumeContact;
  template: ResumeTemplate;
  states: Record<string, ChangeState>;
  applied: Record<string, AppliedChange>;
};

export type ResumeChangesView = {
  reviewId: string;
  summary: string;
  resumeName: string | null;
  target: ReviewTarget;
  changes: ReviewChange[];
  gaps: ReviewGap[];
  original: ChangesTarget;
  copy: ChangesTarget;
};

export type LoadResumeChangesResult = ({ ok: true } & ResumeChangesView) | { ok: false; error: string };

const NOT_FOUND = { ok: false as const, error: "This review isn't available any more." };
const NO_CONTACT: ResumeContact = { fullName: "", links: [] };

type ResumeRow = Parameters<typeof readResume>[0] & { id: string };

function toTarget(
  row: ResumeRow,
  resumeId: string | null,
  changes: ReviewChange[],
  applied: Record<string, AppliedChange>,
): ChangesTarget {
  const { content, contact, template } = readResume(row);
  const { planned } = planChangeOperations(
    content,
    changes.map((change) => ({ change })),
  );
  const states = Object.fromEntries(
    planned.map(({ id, status }): [string, ChangeState] => [
      id,
      applied[id] ? "applied" : status === "changed" ? "changed" : "pending",
    ]),
  );
  return { resumeId, content, contact: contact ?? NO_CONTACT, template, states, applied };
}

/**
 * RI-REQ-023: a review's changes against the resumes they can land on, for the
 * card. Scoped to `user`, so a review id from a tool call can't reach anyone
 * else's resume. Reads only, and it holds contact details, so only the owner gets it.
 */
export async function loadResumeChanges(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  reviewId: string,
): Promise<LoadResumeChangesResult> {
  const { data: review, error } = await supabase
    .from("resume_reviews")
    .select(
      "id, resume_id, applied_copy_id, ai_response, job_id, target_jd, focus, all_jobs(job_name, company_name), resume_review_applied(bullet_id, target_resume_id, previous_text, applied_text)",
    )
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the review: ${error.message}`);
  if (!review?.resume_id) return NOT_FOUND;

  const ids = [review.resume_id, ...(review.applied_copy_id ? [review.applied_copy_id] : [])];
  const { data: resumes, error: resumesError } = await supabase
    .from("resumes")
    .select("id, name, content, contact, template, revision, schema_version")
    .in("id", ids)
    .eq("user_id", user.id);
  if (resumesError) throw new Error(`Failed to read the resume: ${resumesError.message}`);

  const source = resumes?.find((row) => row.id === review.resume_id);
  if (!source) return NOT_FOUND;
  const copy = resumes?.find((row) => row.id === review.applied_copy_id);

  const changes = readChanges(review.ai_response);
  const appliedTo = (resumeId: string) =>
    Object.fromEntries(
      (review.resume_review_applied ?? [])
        .filter((row) => row.target_resume_id === resumeId)
        .map((row): [string, AppliedChange] => [row.bullet_id, { previous: row.previous_text, text: row.applied_text }]),
    );

  const feedback = (review.ai_response as { overall_feedback?: unknown } | null)?.overall_feedback;
  return {
    ok: true,
    reviewId: review.id,
    summary: typeof feedback === "string" ? feedback : "",
    resumeName: source.name,
    target: reviewTarget(review),
    changes,
    gaps: readGaps(review.ai_response),
    original: toTarget(source, source.id, changes, appliedTo(source.id)),
    copy: copy
      ? toTarget(copy, copy.id, changes, appliedTo(copy.id))
      : toTarget(source, null, changes, {}),
  };
}
