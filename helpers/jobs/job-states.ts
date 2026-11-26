// Client-safe: a job post's lifecycle (plan/job-states/feature-job-states-spec.md,
// JL-REQ-001, JL-REQ-029). The database decides every move
// (`set_job_post_state`); this file mirrors its table only to show the moves a
// viewer may make, and to label states. `test/utils/job-states.ts` holds the
// table both sides are tested against, so they can't drift.

import type { Database } from "@/utils/types/database.types";

export type JobPostState = Database["public"]["Enums"]["job_post_state"];
export type JobCloseReason = Database["public"]["Enums"]["job_close_reason"];

export const JOB_POST_STATES = [
  "draft",
  "pending_approval",
  "open",
  "paused",
  "closed",
  "filled",
] as const satisfies readonly JobPostState[];

export const JOB_STATE_LABEL: Record<JobPostState, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  open: "Open",
  paused: "Paused",
  closed: "Closed",
  filled: "Filled",
};

/** JL-REQ-029: brand for Open, muted for Draft and Paused, outline for the archive. */
export const JOB_STATE_BADGE: Record<JobPostState, "brand" | "secondary" | "outline" | "warning"> = {
  draft: "secondary",
  pending_approval: "warning",
  open: "brand",
  paused: "secondary",
  closed: "outline",
  filled: "outline",
};

export function isJobPostState(value: unknown): value is JobPostState {
  return typeof value === "string" && (JOB_POST_STATES as readonly string[]).includes(value);
}

/** A closed job's reason (JL-REQ-002). `deadline` is set by the auto-close only. */
export const CLOSE_REASONS = ["cancelled", "on_hold_indefinitely", "other"] as const satisfies readonly JobCloseReason[];
export type ManualCloseReason = (typeof CLOSE_REASONS)[number];

export const CLOSE_REASON_LABEL: Record<JobCloseReason, string> = {
  cancelled: "Cancelled",
  deadline: "Closing date passed",
  on_hold_indefinitely: "On hold indefinitely",
  other: "Other",
};

export function isManualCloseReason(value: unknown): value is ManualCloseReason {
  return typeof value === "string" && (CLOSE_REASONS as readonly string[]).includes(value);
}

/** Settings → Jobs, where owners turn approval on (JL-REQ-018). */
export const JOB_SETTINGS_PATH = "/company/settings/jobs";

/** A note on a move is kept on its event, never on the job (JL-REQ-002). */
export const STATE_NOTE_MAX = 500;

/** JL-REQ-001's table, `from → to`, without who may make the move. */
export const JOB_POST_MOVES: Readonly<Record<JobPostState, readonly JobPostState[]>> = {
  draft: ["open", "pending_approval"],
  pending_approval: ["open", "draft"],
  open: ["paused", "closed", "filled"],
  paused: ["open", "closed", "filled"],
  closed: ["open", "filled"],
  filled: ["open", "closed"],
};

export function moveAllowed(from: JobPostState, to: JobPostState): boolean {
  return JOB_POST_MOVES[from].includes(to);
}

/**
 * Whether the job has been out in the world: everything but a draft or a
 * pending job (JL-REQ-027). Only these have a public row worth syncing.
 */
export function isPublicState(state: JobPostState): boolean {
  return state !== "draft" && state !== "pending_approval";
}

/** `status` as the public readers see it (D1): active exactly when open. */
export function publicStatusOf(state: JobPostState): "active" | "inactive" {
  return state === "open" ? "active" : "inactive";
}

export type JobMoveKind =
  | "publish"
  | "submit"
  | "approve"
  | "request_changes"
  | "withdraw"
  | "pause"
  | "resume"
  | "reopen"
  | "close"
  | "fill";

export type JobMove = { to: JobPostState; kind: JobMoveKind; label: string };

const MOVE_LABEL: Record<JobMoveKind, string> = {
  publish: "Publish",
  submit: "Submit for approval",
  approve: "Approve",
  request_changes: "Request changes",
  withdraw: "Withdraw",
  pause: "Pause",
  resume: "Resume",
  reopen: "Reopen",
  close: "Close",
  fill: "Mark as filled",
};

function move(to: JobPostState, kind: JobMoveKind): JobMove {
  return { to, kind, label: MOVE_LABEL[kind] };
}

export type MoveViewer = {
  /** `jobs.publish` on this job. */
  canPublish: boolean;
  /** `jobs.approve` on this job. */
  canApprove: boolean;
  /** `company_info.job_approval_required`. */
  approvalRequired: boolean;
  /** Whether the viewer submitted the pending job (they may withdraw it). */
  isSubmitter?: boolean;
};

/**
 * The moves `viewer` may make from `state`, for the state menu (JL-REQ-029).
 * The same rules as `set_job_post_state`, which checks them again.
 */
export function allowedMoves(state: JobPostState, viewer: MoveViewer): JobMove[] {
  const { canPublish, canApprove, approvalRequired, isSubmitter = false } = viewer;
  switch (state) {
    case "draft":
      if (!canPublish) return [];
      // D6 / JL-REQ-020: a publisher who can't approve submits instead.
      return approvalRequired && !canApprove ? [move("pending_approval", "submit")] : [move("open", "publish")];
    case "pending_approval": {
      const moves: JobMove[] = [];
      if (canApprove) moves.push(move("open", "approve"), move("draft", "request_changes"));
      if (canPublish && isSubmitter) moves.push(move("draft", "withdraw"));
      return moves;
    }
    case "open":
      return canPublish ? [move("paused", "pause"), move("filled", "fill"), move("closed", "close")] : [];
    case "paused":
      return canPublish ? [move("open", "resume"), move("filled", "fill"), move("closed", "close")] : [];
    case "closed":
      return canPublish ? [move("open", "reopen"), move("filled", "fill")] : [];
    case "filled":
      return canPublish ? [move("open", "reopen"), { to: "closed", kind: "close", label: "Mark as closed" }] : [];
  }
}

/** An approver's decision on a pending job (JL-REQ-031) and the state it moves to. */
export const REVIEW_DECISIONS = ["approve", "request_changes"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_STATE: Record<ReviewDecision, JobPostState> = {
  approve: "open",
  request_changes: "draft",
};

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === "string" && (REVIEW_DECISIONS as readonly string[]).includes(value);
}

/** JL-REQ-029: the job list's state filter. The first is the default. */
export const JOB_STATE_FILTERS = [
  { value: "current", label: "Open and paused", states: ["open", "paused"] },
  { value: "drafts", label: "Drafts", states: ["draft"] },
  { value: "pending", label: "Waiting for approval", states: ["pending_approval"] },
  { value: "archive", label: "Closed and filled", states: ["closed", "filled"] },
  // Archived posts (removed, but with applications) show only here, in any state; "All" leaves them out.
  { value: "archived", label: "Archived", states: [...JOB_POST_STATES] },
  { value: "all", label: "All", states: [...JOB_POST_STATES] },
] as const satisfies readonly { value: string; label: string; states: readonly JobPostState[] }[];

export type JobStateFilter = (typeof JOB_STATE_FILTERS)[number]["value"];
export const DEFAULT_JOB_STATE_FILTER: JobStateFilter = "current";

export function statesForFilter(value: string | null | undefined): readonly JobPostState[] {
  return (JOB_STATE_FILTERS.find((f) => f.value === value) ?? JOB_STATE_FILTERS[0]).states;
}
