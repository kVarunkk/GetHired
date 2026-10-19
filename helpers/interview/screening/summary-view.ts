// How a company list shows one application's AI interview (SI-REQ-033,
// SIT-062). Client-safe.

export type InterviewSummary = {
  /** application_interviews.id */
  id: string;
  status: string;
  /** The company report's overall score (1–5), when scored. */
  overallScore: number | null;
  /** completed only: "ready" scored or not, "pending" while the analysis runs, "none" when too short to score. */
  report: "ready" | "pending" | "none";
};

export type InterviewBadge = { label: string; tone: "neutral" | "active" | "done" | "muted" | "warning" };

const STATUS_BADGES: Record<string, InterviewBadge> = {
  invited: { label: "Invited", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  in_progress: { label: "In progress", tone: "active" },
  expired: { label: "Expired", tone: "muted" },
  declined: { label: "Declined", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
  withdrawn: { label: "Withdrawn", tone: "muted" },
};

export function interviewBadge(summary: InterviewSummary): InterviewBadge {
  if (summary.status !== "completed") return STATUS_BADGES[summary.status] ?? { label: summary.status, tone: "muted" };
  if (summary.overallScore !== null) return { label: `${summary.overallScore.toFixed(1)} / 5`, tone: "done" };
  if (summary.report === "pending") return { label: "Scoring…", tone: "active" };
  if (summary.report === "ready") return { label: "Not scored", tone: "muted" };
  return { label: "Incomplete", tone: "warning" };
}

/** Invited or paused: not taken yet, and cancelled by a move to Rejected or Hired. */
export const isOpenInterview = (status: string | null | undefined) => status === "invited" || status === "paused";
