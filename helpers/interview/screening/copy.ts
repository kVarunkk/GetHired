// Copy for the screening interview functions' reasons. Client-safe, so the
// applicants list and the applicant page show the same words as the actions.
// Names the missing permission, never a role (test/no-role-names-in-copy.test.ts).

/** Why one application wasn't invited (create_screening_invite, inviteApplicants). */
export const INVITE_SKIP_MESSAGES: Record<string, string> = {
  disabled: "The AI interview is turned off for this job.",
  manual_only: "This job only invites applicants by hand.",
  job_inactive: "The job post isn't open.",
  exists: "Already invited.",
  not_applicant: "This application can't be invited.",
  insufficient_credits: "Not enough interview minutes or credits.",
  member_limit: "Your role's monthly interview minutes are used up.",
  not_found: "Application not found.",
  failed: "Couldn't invite this applicant. Try again.",
};

export const inviteSkipMessage = (reason: string) => INVITE_SKIP_MESSAGES[reason] ?? INVITE_SKIP_MESSAGES.failed;

/** manage_screening_interview's reasons. */
export const MANAGE_MESSAGES: Record<string, string> = {
  not_found: "Interview not found.",
  forbidden: "Your role can't manage AI interviews for this job.",
  invalid_status: "That isn't possible at this stage of the interview.",
  invalid_days: "Extend by 1 to 14 days.",
  limit_reached: "That's already been used the maximum number of times.",
  insufficient_credits: "Not enough interview minutes or credits for another attempt.",
  member_limit: "Your role's monthly interview minutes are used up.",
};

export const manageMessage = (reason: string) => MANAGE_MESSAGES[reason] ?? "Couldn't update the interview. Try again.";

/** The applicant functions' reasons (consent, decline, accommodation, start). */
export const APPLICANT_MESSAGES: Record<string, string> = {
  not_found: "Interview not found.",
  not_invited: "This interview isn't open any more.",
  expired: "The deadline for this interview has passed.",
  no_consent: "Agree to the interview terms first.",
  no_attempts: "You've used all your attempts.",
  active_session: "Your interview is already open in another tab or device.",
  reservation_expired: "Starting took too long. Try again.",
  invalid_text: "Write up to 500 characters.",
};

export const applicantMessage = (reason: string) => APPLICANT_MESSAGES[reason] ?? "Something went wrong. Try again.";
