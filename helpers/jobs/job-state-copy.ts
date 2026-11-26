// Client-safe: the copy for every reason `set_job_post_state` refuses with
// (JL-REQ-005). It names the missing permission, never a role
// (test/no-role-names-in-copy.test.ts).

import { forbiddenMessage } from "@/helpers/companies/permissions";
import { STATE_NOTE_MAX } from "./job-states";

export const JOB_STATE_REFUSALS = {
  not_found: "Job posting not found.",
  forbidden: forbiddenMessage("jobs.publish"),
  invalid_transition: "This job can't move to that state from where it is now.",
  approval_required: `This company requires approval before a job opens, and ${lowerFirst(forbiddenMessage("jobs.approve"))} Submit it for approval instead.`,
  active_job_posts: "Your plan's active job post limit is reached.",
  no_public_row: "The job's public listing couldn't be created. Try again.",
  closes_at_past: "The closing date has passed. Clear it or move it forward before reopening the job.",
  reason_required: "Pick a reason for closing the job.",
  note_required: "Add a note saying what to change.",
  note_too_long: `Notes can be at most ${STATE_NOTE_MAX} characters.`,
} as const;

export type JobStateRefusal = keyof typeof JOB_STATE_REFUSALS;

export const JOB_STATE_FAILED = "Failed to update the job posting.";

/** The copy for a refusal reason, or the generic failure for one we don't know. */
export function jobStateRefusalCopy(reason: string | null | undefined): string {
  return reason && reason in JOB_STATE_REFUSALS ? JOB_STATE_REFUSALS[reason as JobStateRefusal] : JOB_STATE_FAILED;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
