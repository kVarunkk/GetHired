/** The query flag a new job's page opens with, for the "may fit" notice (CP-REQ-061). */
export const JOB_CREATED_PARAM = "created";

/** A job post's page; `created` right after the job was made. */
export const jobPostPath = (jobId: string, { created = false }: { created?: boolean } = {}) =>
  `/company/job-posts/${jobId}${created ? `?${JOB_CREATED_PARAM}=1` : ""}`;

/** A job's Pipeline section (JPT-035). */
export const jobPipelinePath = (jobId: string) => `/company/job-posts/${jobId}/pipeline`;

/** The page that moves a job and its candidates to another pipeline (JPT-036), optionally with a target picked. */
export const jobPipelineSwitchPath = (jobId: string, { to }: { to?: string } = {}) =>
  `${jobPipelinePath(jobId)}/switch${to ? `?to=${encodeURIComponent(to)}` : ""}`;

/** A job's "From your candidates" section (CP-REQ-060). */
export const jobPoolMatchesPath = (jobId: string) => `/company/job-posts/${jobId}/from-your-candidates`;

/** A job's Distribution section (MPT-015). */
export const jobDistributionPath = (jobId: string) => `/company/job-posts/${jobId}/distribution`;

/** The company's job posts list. `archived` shows the archived ones instead. */
export const JOB_POSTS_PATH = "/company/job-posts";
export const archivedJobPostsPath = `${JOB_POSTS_PATH}?archived=1`;
