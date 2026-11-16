// Copy for the human interview RPCs' reasons (IVT-012, IVT-016/017).
// Client-safe, so pages and actions show the same words. Names the missing
// permission, never a role (test/no-role-names-in-copy.test.ts).

const FALLBACK = "Something went wrong. Please try again.";

/** save_interview_plan / copy_interview_plan. */
export const PLAN_MESSAGES: Record<string, string> = {
  not_found: "Job posting not found.",
  forbidden: "Your role can't edit interview plans for this job.",
  invalid_plan: "Each interview needs a name, a length and at least one competency.",
  invalid_stage: "Pick an open stage for each interview. Rejected and Hired can't have interviews.",
  invalid_interviewers: "Default interviewers must be members of your team.",
};

export const planMessage = (reason: string) => PLAN_MESSAGES[reason] ?? FALLBACK;

/** record_interview / update_interview / cancel_interview / mark_interview (IVT-016). */
export const INTERVIEW_MESSAGES: Record<string, string> = {
  not_found: "Interview not found.",
  forbidden: "Your role can't schedule interviews for this job.",
  merged: "This application was merged into another one. Schedule interviews there.",
  closed: "This application is in a Rejected or Hired stage. Move it back to an open stage first.",
  invalid_plan_item: "That interview isn't in this job's plan any more. Pick another one.",
  already_scheduled:
    "This candidate already has this interview scheduled or waiting for them to pick a time. Reschedule or cancel that one instead.",
  invalid_name: "Give the interview a name.",
  invalid_duration: "Interviews take 15 to 240 minutes.",
  invalid_panel: "Pick 1 to 6 interviewers from your team.",
  invalid_time: "Pick when the interview starts.",
  invalid_url: "Use a meeting link that starts with https://.",
  invalid_status: "This interview can't be changed in its current state.",
  not_started: "This interview hasn't started yet.",
  too_late: "No-shows can only be marked within 7 days of the interview.",
};

export const interviewMessage = (reason: string) => INTERVIEW_MESSAGES[reason] ?? FALLBACK;

/** interviewer_reminders (IVT-084): when there's nobody to remind. */
export const REMINDER_MESSAGES: Record<string, string> = {
  not_started: "This interview hasn't started yet, so there's no scorecard to write.",
  no_feedback: "Only scheduled or completed interviews have scorecards to remind people about.",
  feedback_closed: "Scorecards for this interview closed 7 days after it ended.",
};

export const reminderMessage = (reason: string) => REMINDER_MESSAGES[reason] ?? interviewMessage(reason);

/** save_scorecard_draft / submit_scorecard / get_interview_kit (IVT-017, IVT-019). */
export const SCORECARD_MESSAGES: Record<string, string> = {
  not_found: "You're not on this interview's panel.",
  invalid_status: "This interview was cancelled or marked as a no-show, so it has no scorecards.",
  invalid_ratings: "Some ratings don't match this interview's competencies. Reload the page and try again.",
  invalid_note: "Keep your notes shorter.",
  ratings_locked: "Your ratings were locked when you submitted.",
  locked: "Your scorecard is locked. Notes can only be edited for 24 hours after you submit.",
  not_started: "You can submit your scorecard once the interview has started.",
  missing_overall: "Pick an overall recommendation before you submit.",
  already_submitted: "You've already submitted this scorecard.",
  expired: "This interview kit has closed.",
};

export const scorecardMessage = (reason: string) => SCORECARD_MESSAGES[reason] ?? FALLBACK;
