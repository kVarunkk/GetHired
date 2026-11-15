// Human interviews (plan/recruiter-interviews/feature-recruiter-interviews-spec.md).
// Client-safe: the plan editor, the scheduler and the server share these.
//
// The SQL functions repeat some of them (`interview_kit_grace`,
// `scorecard_blind_window`, `interview_no_show_window`); config.test.ts reads
// the migrations and checks they agree.

/** IV-REQ-001: what one plan interview can hold. */
export const PLAN_LIMITS = {
  /** Plan interviews per job. */
  items: 20,
  name: 80,
  durationMin: 15,
  durationMax: 240,
  durationDefault: 45,
  instructions: 2000,
  competenciesMin: 1,
  competenciesMax: 10,
  competencyName: 80,
  competencyDescription: 500,
  questions: 10,
  question: 300,
} as const;

/** IV-REQ-020: 1–6 company members on a panel. */
export const PANEL_MAX = 6;

/** IV-REQ-034: kit access lasts this long after `ends_at`, to write the scorecard. */
export const KIT_GRACE_DAYS = 7;

/** IV-REQ-032: a completed interview keeps its panel blind for this long after `ends_at`. */
export const BLIND_WINDOW_DAYS = 7;

/** IV-REQ-024: `completed → no_show` up to this long after `ends_at`. */
export const NO_SHOW_WINDOW_DAYS = 7;

/** IV-REQ-024: `scheduled` becomes `completed` this long after `ends_at`. */
export const AUTO_COMPLETE_MINUTES = 15;

/** IV-REQ-031 (D19): notes on a submitted scorecard stay editable this long. */
export const NOTE_EDIT_HOURS = 24;

/** IV-REQ-040: one reminder this long after the feedback request. */
export const FEEDBACK_REMINDER_HOURS = 24;

/** IV-REQ-041: "feedback overdue" on the dashboard this long after the end. */
export const FEEDBACK_OVERDUE_HOURS = 24;

/** IV-REQ-041: "awaiting candidate" on the dashboard after this long. */
export const AWAITING_CANDIDATE_ALERT_DAYS = 3;

/** IV-REQ-030: scorecard note lengths. */
export const SCORECARD_LIMITS = {
  competencyNote: 2000,
  overallNote: 5000,
} as const;

/** An ad-hoc interview's name (IV-REQ-020). */
export const AD_HOC_NAME_MAX = PLAN_LIMITS.name;

/** IV-REQ-050 (D12): an AI plan draft costs this many agent messages. */
export const PLAN_DRAFT_COST = 1;

/** IV-REQ-051: a feedback summary needs this many submitted scorecards (`feedback_summary_min()` in SQL). */
export const FEEDBACK_SUMMARY_MIN = 2;

/** IV-REQ-051 (D12): a feedback summary costs this many agent messages. */
export const FEEDBACK_SUMMARY_COST = 1;

/** IVT-084: "Remind" emails each interviewer at most once per interview in this window (`interviewer_reminder_gap()`). */
export const REMIND_GAP_HOURS = 24;
