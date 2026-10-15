// Tunables for the recruiter agent (RA-GUD-002). Shared ones stay in
// helpers/agent/config.ts.

/** User messages per recruiter per UTC day (RA-REQ-006). */
export const RA_DAILY_MESSAGE_CAP = 40;
/** Job posts listed in the system prompt (RA-REQ-003). */
export const RA_PROMPT_JOBS = 15;
/** Approved email-sending calls per turn; more are denied (RA-SEC-006). */
export const RA_MAX_EMAIL_ACTIONS_PER_TURN = 3;
/** Applications one status change can cover (RA-SEC-006). */
export const RA_MAX_BULK_APPLICATIONS = 20;
/** Candidates one comparison can cover. */
export const RA_MAX_COMPARE = 5;
/** Job descriptions returned by getJobPost are trimmed to this length. */
export const RA_JOB_DESCRIPTION_MAX_CHARS = 3000;
/** Resume text returned by candidate tools is trimmed to this length. */
export const RA_RESUME_EXCERPT_MAX_CHARS = 2500;
/** Where plan-limit errors send the recruiter. */
export const RA_UPGRADE_URL = "/company/billing";

/** Shown when the safety filter blocks a reply. */
export const RA_CONTENT_FILTER_MESSAGE =
  "I can't help with that. I can help you write job posts, find and compare candidates, and review your applicants.";
