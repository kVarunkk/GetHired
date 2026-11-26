import type { Database } from "@/utils/types/database.types";
import type { JobPostState } from "@/helpers/jobs/job-states";
import { jobPostingOf, type CompanyFixture } from "./recruiter";

type JobPostingRow = Database["public"]["Tables"]["job_postings"]["Row"];

/**
 * JL-REQ-001's move table, the one fixture both sides are checked against:
 * `helpers/jobs/job-states.test.ts` compares it with `JOB_POST_MOVES` and with
 * `job_post_move_allowed` in the migration, and `supabase/tests/job_states.sql`
 * block 1 holds the same pairs.
 */
export const JOB_POST_MOVE_FIXTURE: readonly (readonly [JobPostState, JobPostState])[] = [
  ["draft", "open"],
  ["draft", "pending_approval"],
  ["pending_approval", "open"],
  ["pending_approval", "draft"],
  ["open", "paused"],
  ["open", "closed"],
  ["paused", "closed"],
  ["open", "filled"],
  ["paused", "filled"],
  ["paused", "open"],
  ["closed", "open"],
  ["filled", "open"],
  ["closed", "filled"],
  ["filled", "closed"],
];

/** A job post in `state`, with the columns that follow from it. */
export function makeJobPost(
  owner: CompanyFixture,
  { state, ...overrides }: Partial<JobPostingRow> & { state: JobPostState },
): JobPostingRow {
  const opened = state !== "draft" && state !== "pending_approval";
  return jobPostingOf(owner, {
    state,
    status: state === "open" ? "active" : "inactive",
    ...(opened ? {} : { job_id: null }),
    first_opened_at: opened ? "2026-01-02T00:00:00.000Z" : null,
    closed_at: state === "closed" || state === "filled" ? "2026-02-01T00:00:00.000Z" : null,
    close_reason: state === "closed" ? "cancelled" : null,
    ...overrides,
  });
}
