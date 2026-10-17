import type { MyCompany } from "./get-my-company";
import { can, type PermissionKey } from "./permissions";

// RP-REQ-010. job_postings stays world-readable (the public job board reads
// it), so RLS can't hide a job post from a member scoped to other jobs. Every
// company list of job posts goes through scopeToJobs; job-linked rows
// (applications, notes, outreach, matches, screenings) are filtered by RLS.

const NO_JOB = "00000000-0000-0000-0000-000000000000";

/** The job ids `key` covers for `company`: `"all"`, or the assigned ones. */
export function jobIdsWith(company: MyCompany, key: PermissionKey): "all" | string[] {
  if (can(company, key)) return "all";
  if (!company.grants.has(key)) return [];
  return [...company.assignedJobIds];
}

/** Limits a `job_postings` query to the jobs `key` covers (by default jobs.view). */
export function scopeToJobs<Q extends { in: (column: string, values: string[]) => Q }>(
  query: Q,
  company: MyCompany,
  key: PermissionKey = "jobs.view",
  column = "id",
): Q {
  const ids = jobIdsWith(company, key);
  if (ids === "all") return query;
  return query.in(column, ids.length > 0 ? ids : [NO_JOB]);
}

/** Per-job controls for a job post card or row (RP-REQ-016). */
export type JobControls = { edit: boolean; publish: boolean; delete: boolean };

export function jobControls(company: MyCompany | null | undefined, jobId: string): JobControls {
  return {
    edit: can(company, "jobs.edit", jobId),
    publish: can(company, "jobs.publish", jobId),
    delete: can(company, "jobs.delete", jobId),
  };
}
