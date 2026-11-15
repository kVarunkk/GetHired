import type { Database } from "@/utils/types/database.types";
import { stageOf } from "./pipeline";
import { COMPANY_A } from "./recruiter";
import { JOB_A1, OWNER_A } from "./team";

// Human interview fixtures (IVT-001). Ids are stable per call order:
// `1a…` plan items, `1c…` competencies, `1e…` interviews, `5c…` scorecards.

type Tables = Database["public"]["Tables"];
export type PlanItemRow = Tables["job_interview_plan_items"]["Row"];
export type CompetencyRow = Tables["job_interview_competencies"]["Row"];
export type ScheduledInterviewRow = Tables["scheduled_interviews"]["Row"];
export type PanelRow = Tables["scheduled_interview_panel"]["Row"];
export type ScorecardRow = Tables["interview_scorecards"]["Row"];

const CREATED_AT = "2026-11-14T00:00:00.000Z";
export const APPLICATION_ID = "ab000000-0000-4000-8000-000000000001";

const seqId = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

let itemSeq = 0;
let competencySeq = 0;
let interviewSeq = 0;
let scorecardSeq = 0;

/** A competency of a plan item, with one suggested question. */
export function competencyOf(overrides: Partial<CompetencyRow> = {}): CompetencyRow {
  competencySeq += 1;
  return {
    id: seqId("1c000000", competencySeq),
    plan_item_id: seqId("1a000000", Math.max(itemSeq, 1)),
    position: 0,
    name: `Competency ${competencySeq}`,
    description: "",
    questions: ["Tell me about a hard problem you solved."],
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** A 45-minute plan interview of JOB_A1 under the Screening stage. */
export function planItemOf(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  itemSeq += 1;
  return {
    id: seqId("1a000000", itemSeq),
    company_id: COMPANY_A.id,
    job_post_id: JOB_A1,
    stage_id: stageOf("screening").id,
    position: 0,
    name: `Interview ${itemSeq}`,
    duration_minutes: 45,
    instructions: "",
    default_interviewer_ids: [],
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** The `plan_snapshot` a scheduled interview stores for `item` (IV-REQ-003). */
export function snapshotOf(item: PlanItemRow, competencies: CompetencyRow[]) {
  return {
    plan_item_id: item.id,
    name: item.name,
    duration_minutes: item.duration_minutes,
    instructions: item.instructions,
    stage_id: item.stage_id,
    competencies: competencies.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      questions: c.questions,
    })),
  };
}

type InterviewOverrides = Partial<ScheduledInterviewRow> & {
  /** Sets `starts_at`, and `ends_at` from the duration. */
  startsAt?: Date;
};

/**
 * A manually recorded, scheduled 45-minute interview tomorrow on
 * APPLICATION_ID, with an ad-hoc snapshot (no competencies) unless one is
 * passed.
 */
export function interviewOf(overrides: InterviewOverrides = {}): ScheduledInterviewRow {
  interviewSeq += 1;
  const { startsAt = new Date(Date.parse(CREATED_AT) + 86_400_000), ...rest } = overrides;
  const duration = rest.duration_minutes ?? 45;
  return {
    id: seqId("1e000000", interviewSeq),
    company_id: COMPANY_A.id,
    job_post_id: JOB_A1,
    application_id: APPLICATION_ID,
    plan_item_id: null,
    stage_id: stageOf("screening").id,
    name: `Interview ${interviewSeq}`,
    duration_minutes: duration,
    plan_snapshot: { plan_item_id: null, name: `Interview ${interviewSeq}`, competencies: [] },
    status: "scheduled",
    source: "manual",
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
    time_zone: null,
    meeting_url: null,
    candidate_is_attendee: false,
    organizer_user_id: null,
    provider_event_id: null,
    booking_token_hash: null,
    booking_token_expires_at: null,
    booking_link_sent_at: null,
    slots_cache: null,
    slots_cached_at: null,
    created_by: OWNER_A.user.id,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...rest,
  };
}

/** One panel seat per user on `interview`. */
export function panelOf(interview: ScheduledInterviewRow, userIds: string[]): PanelRow[] {
  return userIds.map((userId) => ({
    interview_id: interview.id,
    user_id: userId,
    company_id: interview.company_id,
    response: "needs_action",
    feedback_requested_at: null,
    feedback_reminded_at: null,
    reminded_at: null,
    created_at: CREATED_AT,
  }));
}

type ScorecardOverrides = Partial<ScorecardRow> & { submitted?: boolean };

/**
 * `author`'s scorecard on `interview`: a draft, or submitted (with an overall
 * and a 24-hour note window) when `submitted` is set. `ratings` is keyed by
 * the snapshot's competency ids.
 */
export function scorecardOf(
  interview: ScheduledInterviewRow,
  author: string,
  { submitted = false, ...overrides }: ScorecardOverrides = {},
): ScorecardRow {
  scorecardSeq += 1;
  const submittedAt = submitted ? "2026-11-15T12:00:00.000Z" : null;
  return {
    id: seqId("5c000000", scorecardSeq),
    interview_id: interview.id,
    application_id: interview.application_id,
    company_id: interview.company_id,
    author_user_id: author,
    status: submitted ? "submitted" : "draft",
    overall: submitted ? "yes" : null,
    overall_note: "",
    ratings: {},
    submitted_at: submittedAt,
    locked_at: submitted ? "2026-11-16T12:00:00.000Z" : null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}
