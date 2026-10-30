/** The query flag a new job's page opens with, for the "may fit" notice (CP-REQ-061). */
export const JOB_CREATED_PARAM = "created";

/** A job post's page; `created` right after the job was made. */
export const jobPostPath = (jobId: string, { created = false }: { created?: boolean } = {}) =>
  `/company/job-posts/${jobId}${created ? `?${JOB_CREATED_PARAM}=1` : ""}`;

/** A job's "From your candidates" section (CP-REQ-060). */
export const jobPoolMatchesPath = (jobId: string) => `/company/job-posts/${jobId}/from-your-candidates`;
