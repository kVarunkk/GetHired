/**
 * Prompts for AgentHandoff, the "describe it instead" line in dialogs that
 * create something. Each one says what the dialog would have made, with the
 * ids the agent's tools need, then the user's own words.
 */

type JobPostRef = { id: string; title: string };

/** Create Job Post / Edit job post (recruiter: createJobPost, updateJobPost). */
export function jobPostHandoffPrompt(text: string, existing?: JobPostRef) {
  const ask = text.trim();
  return existing
    ? `Update my job post "${existing.title}" (job post ${existing.id}): ${ask}`
    : `Write a job post: ${ask} Ask me for anything important that's missing, then create it.`;
}

/** Reach out (recruiter: sendOutreach). */
export function outreachHandoffPrompt(text: string, candidateId: string, job?: JobPostRef | null) {
  const about = job ? ` about my job post "${job.title}" (job post ${job.id})` : "";
  return `Write an outreach message to candidate ${candidateId}${about}. ${text.trim()}`;
}

/** Create CV Review (applicant: startResumeReview). */
export function resumeReviewHandoffPrompt(text: string) {
  return `Review my resume against this job: ${text.trim()}`;
}

/** Easy Apply (applicant: getApplicationForm, submitApplication). */
export function applyHandoffPrompt(text: string, job: { id: string; title: string | null; company: string | null }) {
  const role = `the ${job.title ?? "this"} role${job.company ? ` at ${job.company}` : ""} (/jobs/${job.id})`;
  const notes = text.trim();
  return `Apply to ${role} for me. Fill in the application from my profile and ask me for anything you can't answer.${notes ? ` ${notes}` : ""}`;
}

/** Create Interview (applicant: createInterview). */
export function interviewHandoffPrompt(text: string) {
  return `Set up a mock interview for this job: ${text.trim()}`;
}

/** Add New Resume (applicant: requestResumeUpload). */
export function resumeUploadHandoffPrompt(text: string) {
  return `Help me upload a new resume. ${text.trim()}`;
}

/** Invite a teammate (recruiter: inviteTeamMember). */
export function inviteHandoffPrompt(text: string) {
  return `Invite a teammate: ${text.trim()} Ask me for the email or role if either is missing, then send the invite.`;
}
