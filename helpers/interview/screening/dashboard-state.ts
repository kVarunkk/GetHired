import type { MyScreeningInterview } from "./my-interviews";

// How the applicant dashboard shows a screening interview (SIT-054).

const DAY_MS = 86_400_000;
const SUBMITTED_VISIBLE_DAYS = 14;

export type ScreeningCardState = {
  label: string;
  tone: "action" | "muted" | "done";
  cta: { label: string; href: string } | null;
  /** Waiting on the company or already submitted: the applicant can take it off the dashboard. */
  dismissable: boolean;
};

const dueIn = (deadline: string, now: Date) => {
  const days = Math.floor((new Date(deadline).getTime() - now.getTime()) / DAY_MS);
  return days <= 0 ? "due today" : `due in ${days} ${days === 1 ? "day" : "days"}`;
};

/** "today", "yesterday" or "N days ago". */
const daysAgo = (at: string, now: Date) => {
  const days = Math.floor((now.getTime() - new Date(at).getTime()) / DAY_MS);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

const CLOSED_LABELS: Record<string, string> = {
  expired: "AI interview expired: the deadline passed",
  declined: "You declined this AI interview",
  cancelled: "AI interview cancelled by the company",
  withdrawn: "AI interview closed: you withdrew your application",
};

/**
 * The status to show. The expiry job runs every 15 minutes, so an invite can
 * still read "invited" just after its deadline: it shows as expired already.
 */
export function effectiveStatus(interview: MyScreeningInterview, now = new Date()): string {
  return interview.status === "invited" && new Date(interview.deadline_at).getTime() <= now.getTime()
    ? "expired"
    : interview.status;
}

export function screeningCardState(interview: MyScreeningInterview, now = new Date()): ScreeningCardState {
  const href = `/interview/screening/${interview.id}`;
  const status = effectiveStatus(interview, now);
  switch (status) {
    case "invited": {
      const left = interview.max_attempts - interview.attempts_used;
      return interview.attempts_used > 0
        ? {
            label: `AI interview interrupted: ${left} ${left === 1 ? "attempt" : "attempts"} left, ${dueIn(interview.deadline_at, now)}`,
            tone: "action",
            cta: { label: "Try again", href },
            dismissable: false,
          }
        : {
            label: `AI interview ${dueIn(interview.deadline_at, now)}`,
            tone: "action",
            cta: { label: "Start interview", href },
            dismissable: false,
          };
    }
    case "in_progress":
      return { label: "AI interview in progress", tone: "action", cta: { label: "Open", href }, dismissable: false };
    case "paused": {
      const when = interview.paused_at ? ` ${daysAgo(interview.paused_at, now)}` : "";
      return {
        label: `Alternative format requested${when}: waiting for ${interview.company_name}`,
        tone: "muted",
        cta: { label: "View", href },
        dismissable: true,
      };
    }
    case "completed": {
      const when = interview.completed_at ? ` ${daysAgo(interview.completed_at, now)}` : "";
      return {
        label: `AI interview submitted${when}`,
        tone: "done",
        cta: { label: "View transcript", href },
        dismissable: true,
      };
    }
    default:
      return {
        label: CLOSED_LABELS[status] ?? "AI interview closed",
        tone: "muted",
        cta: { label: "View", href },
        dismissable: false,
      };
  }
}

/** Open interviews, and ones submitted recently, unless the applicant dismissed them. */
export function visibleOnDashboard(interview: MyScreeningInterview, now = new Date()): boolean {
  if (interview.dismissed) return false;
  if (["invited", "in_progress", "paused"].includes(effectiveStatus(interview, now))) return true;
  if (interview.status !== "completed" || !interview.completed_at) return false;
  return now.getTime() - new Date(interview.completed_at).getTime() <= SUBMITTED_VISIBLE_DAYS * DAY_MS;
}
