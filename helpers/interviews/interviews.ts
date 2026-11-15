import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@/utils/types/database.types";
import type { CandidateRating } from "@/helpers/pipeline/ratings";
import { interviewMessage } from "./copy";
import {
  markInterviewSchema,
  recordInterviewSchema,
  updateInterviewSchema,
  type RecordInterviewInput,
  type UpdateInterviewInput,
} from "./interview-schema";

type Db = SupabaseClient<Database>;

export type InterviewStatus = Enums<"scheduled_interview_status">;

export type LifecycleResult =
  | { ok: true; applicationId: string; status: InterviewStatus; id?: string }
  | { ok: false; error: string; field?: string };

type RpcResult = { ok: boolean; reason?: string; id?: string; application_id?: string; status?: InterviewStatus };

function fromRpc(data: unknown): LifecycleResult {
  const result = data as RpcResult | null;
  if (!result?.ok) return { ok: false, error: interviewMessage(result?.reason ?? "") };
  return {
    ok: true,
    applicationId: result.application_id ?? "",
    status: result.status as InterviewStatus,
    ...(result.id ? { id: result.id } : {}),
  };
}

function invalid(error: { issues: { message: string; path: PropertyKey[] }[] }): LifecycleResult {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: issue.path.join(".") };
}

/**
 * Records an interview arranged outside GetHired (IV-REQ-020 "Record
 * manually"). `record_interview` checks `scheduling.manage` on the job, the
 * panel, the stage and the plan item.
 */
export async function recordInterview(supabase: Db, input: RecordInterviewInput): Promise<LifecycleResult> {
  const parsed = recordInterviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { data, error } = await supabase.rpc("record_interview", {
    p_application_id: v.applicationId,
    p_panel: v.panel,
    p_starts_at: v.startsAt,
    ...(v.planItemId
      ? { p_plan_item_id: v.planItemId }
      : { p_name: v.name ?? undefined, p_duration_minutes: v.durationMinutes ?? undefined }),
    ...(v.meetingUrl ? { p_meeting_url: v.meetingUrl } : {}),
  });
  if (error) throw new Error(`Couldn't record the interview: ${error.message}`);
  return fromRpc(data);
}

/** Reschedules, changes the panel or the meeting link (IV-REQ-023). */
export async function updateInterview(supabase: Db, input: UpdateInterviewInput): Promise<LifecycleResult> {
  const parsed = updateInterviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const clear = v.meetingUrl === null || v.meetingUrl === "";
  const { data, error } = await supabase.rpc("update_interview", {
    p_id: v.interviewId,
    ...(v.startsAt ? { p_starts_at: v.startsAt } : {}),
    ...(v.panel ? { p_panel: v.panel } : {}),
    ...(v.meetingUrl ? { p_meeting_url: v.meetingUrl } : {}),
    ...(clear ? { p_clear_meeting_url: true } : {}),
  });
  if (error) throw new Error(`Couldn't update the interview: ${error.message}`);
  return fromRpc(data);
}

export async function cancelInterview(supabase: Db, interviewId: string): Promise<LifecycleResult> {
  const { data, error } = await supabase.rpc("cancel_interview", { p_id: interviewId });
  if (error) throw new Error(`Couldn't cancel the interview: ${error.message}`);
  return fromRpc(data);
}

/** `completed` or `no_show` (IV-REQ-024); the RPC enforces the times. */
export async function markInterview(
  supabase: Db,
  input: { interviewId: string; status: "completed" | "no_show" },
): Promise<LifecycleResult> {
  const parsed = markInterviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { data, error } = await supabase.rpc("mark_interview", {
    p_id: parsed.data.interviewId,
    p_status: parsed.data.status,
  });
  if (error) throw new Error(`Couldn't update the interview: ${error.message}`);
  return fromRpc(data);
}

// ---------------------------------------------------------------------------
// The application's Interviews section (IVT-018, IV-REQ-020/033)
// ---------------------------------------------------------------------------

export type SnapshotCompetency = { id: string; name: string; description: string; questions: string[] };

export type CompetencyRating = { rating: CandidateRating | null; note: string };

/** One panel seat and its scorecard, as far as the reader may see it (IV-REQ-032). */
export type PanelSeat = {
  userId: string;
  name: string;
  response: Enums<"interview_panel_response">;
  scorecardStatus: "none" | "draft" | "submitted";
  submittedAt: string | null;
  /** Whether the content below is shown: the reader's own, or readable feedback. */
  visible: boolean;
  overall: CandidateRating | null;
  overallNote: string | null;
  ratings: Record<string, CompetencyRating> | null;
};

export type CompetencySummary = {
  id: string;
  name: string;
  counts: Record<CandidateRating, number>;
};

export type ApplicationInterview = {
  id: string;
  name: string;
  status: InterviewStatus;
  source: Enums<"scheduled_interview_source">;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  meetingUrl: string | null;
  stageId: string | null;
  planItemId: string | null;
  /** Who booked it on their Google Calendar (IVT-043); null for a recorded one. */
  organizerUserId: string | null;
  /** It has a Google Calendar event. */
  onCalendar: boolean;
  competencies: SnapshotCompetency[];
  panel: PanelSeat[];
  submitted: number;
  /** Submitted scorecards the reader can't see (blind review). */
  hidden: number;
  /** Ratings per competency from the submitted scorecards the reader can see. */
  summary: CompetencySummary[];
};

export type InterviewStageGroup = { stageId: string | null; stageName: string; interviews: ApplicationInterview[] };

const INTERVIEW_COLUMNS =
  "id, name, status, source, starts_at, ends_at, duration_minutes, meeting_url, stage_id, plan_item_id, plan_snapshot, created_at, organizer_user_id, provider_event_id";

function competenciesOf(snapshot: unknown): SnapshotCompetency[] {
  const list = (snapshot as { competencies?: unknown } | null)?.competencies;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof c.id === "string")
    .map((c) => ({
      id: c.id as string,
      name: typeof c.name === "string" ? c.name : "",
      description: typeof c.description === "string" ? c.description : "",
      questions: Array.isArray(c.questions) ? c.questions.filter((q): q is string => typeof q === "string") : [],
    }));
}

function ratingsOf(raw: unknown): Record<string, CompetencyRating> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, CompetencyRating> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as { rating?: CandidateRating | null; note?: string };
    out[id] = { rating: v.rating ?? null, note: v.note ?? "" };
  }
  return out;
}

const emptyCounts = (): Record<CandidateRating, number> => ({ strong_no: 0, no: 0, yes: 0, strong_yes: 0 });

/**
 * An application's interviews, grouped by the stage they were planned under,
 * with each panel seat's scorecard state. Interviews come through RLS
 * (`scheduling.view` for the job); scorecards through
 * `list_interview_scorecards`, which hides other members' content while the
 * reader is blind. Returns `[]` without access.
 */
export async function listApplicationInterviews(supabase: Db, applicationId: string): Promise<InterviewStageGroup[]> {
  const [interviewsRes, seatsRes] = await Promise.all([
    supabase
      .from("scheduled_interviews")
      .select(INTERVIEW_COLUMNS)
      .eq("application_id", applicationId)
      .order("starts_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.rpc("list_interview_scorecards", { p_application_id: applicationId }),
  ]);
  if (interviewsRes.error) throw new Error(`Couldn't load interviews: ${interviewsRes.error.message}`);
  if (seatsRes.error) throw new Error(`Couldn't load scorecards: ${seatsRes.error.message}`);
  const rows = interviewsRes.data ?? [];
  if (rows.length === 0) return [];

  const seatsByInterview = new Map<string, PanelSeat[]>();
  for (const s of seatsRes.data ?? []) {
    const visible = s.content_visible === true;
    const seat: PanelSeat = {
      userId: s.author_user_id,
      name: s.author_name ?? "Teammate",
      response: s.response,
      scorecardStatus: (s.status === "draft" || s.status === "submitted" ? s.status : "none") as PanelSeat["scorecardStatus"],
      submittedAt: s.submitted_at,
      visible,
      overall: visible ? s.overall : null,
      overallNote: visible ? s.overall_note : null,
      ratings: visible ? ratingsOf(s.ratings) : null,
    };
    seatsByInterview.set(s.interview_id, [...(seatsByInterview.get(s.interview_id) ?? []), seat]);
  }

  const stageIds = [...new Set(rows.map((r) => r.stage_id).filter((id): id is string => !!id))];
  const { data: stages } = stageIds.length
    ? await supabase.from("pipeline_stages").select("id, name, position").in("id", stageIds)
    : { data: [] as { id: string; name: string; position: number }[] };
  const stageById = new Map((stages ?? []).map((s) => [s.id, s]));

  const interviews: ApplicationInterview[] = rows.map((r) => {
    const competencies = competenciesOf(r.plan_snapshot);
    const panel = seatsByInterview.get(r.id) ?? [];
    const submittedSeats = panel.filter((p) => p.scorecardStatus === "submitted");
    const readable = submittedSeats.filter((p) => p.visible);
    const summary = competencies.map((c) => {
      const counts = emptyCounts();
      for (const seat of readable) {
        const value = seat.ratings?.[c.id]?.rating;
        if (value) counts[value] += 1;
      }
      return { id: c.id, name: c.name, counts };
    });
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      source: r.source,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      durationMinutes: r.duration_minutes,
      meetingUrl: r.meeting_url,
      stageId: r.stage_id,
      planItemId: r.plan_item_id,
      organizerUserId: r.organizer_user_id,
      onCalendar: r.provider_event_id !== null,
      competencies,
      panel,
      submitted: submittedSeats.length,
      hidden: submittedSeats.length - readable.length,
      summary,
    };
  });

  const groups = new Map<string, InterviewStageGroup>();
  for (const interview of interviews) {
    const key = interview.stageId ?? "";
    const stage = interview.stageId ? stageById.get(interview.stageId) : undefined;
    if (!groups.has(key)) {
      groups.set(key, { stageId: interview.stageId, stageName: stage?.name ?? "Other", interviews: [] });
    }
    groups.get(key)!.interviews.push(interview);
  }
  const rank = (g: InterviewStageGroup) => (g.stageId ? (stageById.get(g.stageId)?.position ?? 1e6) : 1e7);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
