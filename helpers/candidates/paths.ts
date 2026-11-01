// Company candidate page paths. Client-safe.

export const candidatePath = (candidateId: string) => `/company/candidates/${candidateId}`;

/** The company's candidates (BI-REQ-003), the candidate pages' parent list. */
export const CANDIDATES_LIST_PATH = "/company/candidates";

/** The add-candidate page, optionally with a job preselected (BI-REQ-009). */
export const newCandidatePath = (jobId?: string) =>
  jobId ? `/company/candidates/new?job=${encodeURIComponent(jobId)}` : "/company/candidates/new";

/** The ways to add people (CP-REQ-010), each its own tab and route. Resumes first: the default (CP-DEC-004). */
export const IMPORT_METHODS = ["resumes", "spreadsheet", "form"] as const;
export type ImportMethod = (typeof IMPORT_METHODS)[number];

export const isImportMethod = (value: unknown): value is ImportMethod =>
  (IMPORT_METHODS as readonly unknown[]).includes(value);

/** A job's "Import candidates" section (CP-REQ-021). */
export const jobImportPath = (jobId: string, method: ImportMethod = "resumes") =>
  `/company/job-posts/${jobId}/import/${method}`;

/** The Candidates page's import methods: its form is `newCandidatePath()`, not a tab (CP-REQ-031). */
export type CandidateImportMethod = Exclude<ImportMethod, "form">;

/** The Candidates page's import page (CP-REQ-031). */
export const candidateImportPath = (method: CandidateImportMethod = "resumes") => `/company/candidates/import/${method}`;

/**
 * BIT-105: the applicant onboarding form, prefilled from a claimed candidate,
 * returning to where the claim was going (the interview) once it's saved.
 */
export const claimPrefillPath = (token: string, returnTo: string) =>
  `/get-started?claim=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`;
