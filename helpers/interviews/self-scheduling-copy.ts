// What the candidate reads on /schedule/[token] (IVT-063). Client-safe.
// The candidate isn't a member, so no permission names here.

export const SELF_SCHEDULING_MESSAGES: Record<string, string> = {
  not_found: "This link has expired, or the interview was cancelled. Ask the company for a new link.",
  already_booked: "This interview is already booked. Reload the page to see the time.",
  not_booked: "This interview isn't booked yet. Pick a time below.",
  slot_taken: "That time was just taken. Pick another one.",
  invalid_time: "That time isn't available any more. Pick another one.",
  same_time: "That's the time already booked. Pick a different one.",
  too_late:
    "The interview starts in less than 4 hours, so it can't be changed here. Reply to the calendar invite to reach the interviewers.",
  cant_change: "This interview can't be moved here. Reply to the calendar invite to ask for another time.",
  calendar_failed: "We couldn't book that time. Please try again.",
  rate_limited: "Too many tries. Wait a few minutes and try again.",
  invalid: "Pick a time.",
};

export const selfSchedulingMessage = (reason: string) =>
  SELF_SCHEDULING_MESSAGES[reason] ?? "Something went wrong. Please try again.";
