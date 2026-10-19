import type { MyScreeningInterview } from "./my-interviews";

// How the applicant dashboard shows a screening interview (SIT-054).

const DAY_MS = 86_400_000;
const SUBMITTED_VISIBLE_DAYS = 14;

export type ScreeningCardState = {
  label: string;
  tone: "action" | "muted" | "done";
  cta: { label: string; href: string } | null;
};

const dueIn = (deadline: string, now: Date) => {
  const days = Math.floor((new Date(deadline).getTime() - now.getTime()) / DAY_MS);
  return days <= 0 ? "due today" : `due in ${days} ${days === 1 ? "day" : "days"}`;
};

export function screeningCardState(interview: MyScreeningInterview, now = new Date()): ScreeningCardState {
  const href = `/interview/screening/${interview.id}`;
  switch (interview.status) {
    case "invited": {
      const left = interview.max_attempts - interview.attempts_used;
      return interview.attempts_used > 0
        ? {
            label: `AI interview interrupted: ${left} ${left === 1 ? "attempt" : "attempts"} left, ${dueIn(interview.deadline_at, now)}`,
            tone: "action",
            cta: { label: "Try again", href },
          }
        : { label: `AI interview ${dueIn(interview.deadline_at, now)}`, tone: "action", cta: { label: "Start interview", href } };
    }
    case "in_progress":
      return { label: "AI interview in progress", tone: "action", cta: { label: "Open", href } };
    case "paused":
      return {
        label: `Alternative format requested: waiting for ${interview.company_name}`,
        tone: "muted",
        cta: { label: "View", href },
      };
    case "completed":
      return { label: "AI interview submitted", tone: "done", cta: { label: "View transcript", href } };
    default:
      return { label: "AI interview closed", tone: "muted", cta: null };
  }
}

/** Open interviews, and ones submitted recently. */
export function visibleOnDashboard(interview: MyScreeningInterview, now = new Date()): boolean {
  if (["invited", "in_progress", "paused"].includes(interview.status)) return true;
  if (interview.status !== "completed" || !interview.completed_at) return false;
  return now.getTime() - new Date(interview.completed_at).getTime() <= SUBMITTED_VISIBLE_DAYS * DAY_MS;
}
