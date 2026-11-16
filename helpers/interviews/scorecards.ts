import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import type { CandidateRating } from "@/helpers/pipeline/ratings";
import { scorecardMessage } from "./copy";
import { scorecardDraftSchema, type ScorecardDraftInput } from "./interview-schema";
import type { CompetencyRating, InterviewStatus, SnapshotCompetency } from "./interviews";

type Db = SupabaseClient<Database>;

export type ScorecardSaveResult =
  | {
      ok: true;
      id: string;
      applicationId: string;
      status: "draft" | "submitted";
      updatedAt: string;
      lockedAt: string | null;
    }
  | { ok: false; error: string };

export type ScorecardSubmitResult =
  | { ok: true; id: string; applicationId: string; submittedAt: string; lockedAt: string }
  | { ok: false; error: string };

type RpcResult = {
  ok: boolean;
  reason?: string;
  id?: string;
  application_id?: string;
  status?: "draft" | "submitted";
  updated_at?: string;
  submitted_at?: string;
  locked_at?: string | null;
};

/**
 * Autosaves the session member's own scorecard (IV-REQ-030). Only a panel
 * member can, for their own row: `save_scorecard_draft` takes the author from
 * the session. After submitting, only the notes change, for 24 hours (D19).
 */
export async function saveScorecardDraft(supabase: Db, input: ScorecardDraftInput): Promise<ScorecardSaveResult> {
  const parsed = scorecardDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const { data, error } = await supabase.rpc("save_scorecard_draft", {
    p_interview_id: v.interviewId,
    p_ratings: v.ratings as Json,
    ...(v.overall ? { p_overall: v.overall } : {}),
    p_overall_note: v.overallNote,
  });
  if (error) throw new Error(`Couldn't save the scorecard: ${error.message}`);
  const r = data as RpcResult | null;
  if (!r?.ok) return { ok: false, error: scorecardMessage(r?.reason ?? "") };
  return {
    ok: true,
    id: r.id!,
    applicationId: r.application_id ?? "",
    status: r.status ?? "draft",
    updatedAt: r.updated_at ?? new Date().toISOString(),
    lockedAt: r.locked_at ?? null,
  };
}

/** Submits it (IV-REQ-031): ratings lock for good, notes after 24 hours. */
export async function submitScorecard(supabase: Db, interviewId: string): Promise<ScorecardSubmitResult> {
  const { data, error } = await supabase.rpc("submit_scorecard", { p_interview_id: interviewId });
  if (error) throw new Error(`Couldn't submit the scorecard: ${error.message}`);
  const r = data as RpcResult | null;
  if (!r?.ok) return { ok: false, error: scorecardMessage(r?.reason ?? "") };
  return {
    ok: true,
    id: r.id!,
    applicationId: r.application_id ?? "",
    submittedAt: r.submitted_at!,
    lockedAt: r.locked_at!,
  };
}

// ---------------------------------------------------------------------------
// The interview kit (IVT-019, IV-REQ-034)
// ---------------------------------------------------------------------------

export type KitScorecard = {
  id: string;
  status: "draft" | "submitted";
  overall: CandidateRating | null;
  overallNote: string;
  ratings: Record<string, CompetencyRating>;
  submittedAt: string | null;
  lockedAt: string | null;
  updatedAt: string;
};

type KitInterviewBase = {
  id: string;
  name: string;
  status: InterviewStatus;
  startsAt: string | null;
  endsAt: string | null;
  competencies: SnapshotCompetency[];
};

export type InterviewKit =
  | {
      access: "kit";
      interview: KitInterviewBase & {
        applicationId: string;
        durationMinutes: number;
        meetingUrl: string | null;
        instructions: string;
        panel: { userId: string; name: string }[];
      };
      job: { id: string; title: string; questions: string[] | null };
      candidate: { name: string; hasResume: boolean };
      application: { answers: Json; answersV2: Json; formSnapshot: Json };
      scorecard: KitScorecard | null;
    }
  | { access: "scorecard_only"; interview: KitInterviewBase; scorecard: KitScorecard };

export type KitResult = { ok: true; kit: InterviewKit } | { ok: false; reason: "not_found" | "expired"; error: string };

type RawCard = {
  id: string;
  status: "draft" | "submitted";
  overall: CandidateRating | null;
  overall_note: string | null;
  ratings: Record<string, { rating?: CandidateRating | null; note?: string }> | null;
  submitted_at: string | null;
  locked_at: string | null;
  updated_at: string;
};

/** What `get_interview_kit` returns. */
type RawKit = {
  ok?: boolean;
  reason?: string;
  access?: "kit" | "scorecard_only";
  interview: {
    id: string;
    name: string;
    status: InterviewStatus;
    starts_at?: string | null;
    ends_at?: string | null;
    competencies?: unknown;
    application_id: string;
    duration_minutes: number;
    meeting_url?: string | null;
    instructions?: string | null;
    panel?: { user_id: string; name: string | null }[] | null;
  };
  job: { id: string; title: string; questions?: string[] | null };
  candidate?: { name?: string | null; has_resume?: boolean } | null;
  application?: { answers?: Json; answers_v2?: Json; form_snapshot?: Json } | null;
  scorecard?: RawCard | null;
};

function cardOf(raw: RawCard | null | undefined): KitScorecard | null {
  if (!raw) return null;
  const ratings: Record<string, CompetencyRating> = {};
  for (const [id, v] of Object.entries(raw.ratings ?? {})) ratings[id] = { rating: v?.rating ?? null, note: v?.note ?? "" };
  return {
    id: raw.id,
    status: raw.status,
    overall: raw.overall,
    overallNote: raw.overall_note ?? "",
    ratings,
    submittedAt: raw.submitted_at,
    lockedAt: raw.locked_at,
    updatedAt: raw.updated_at,
  };
}

function competencies(raw: unknown): SnapshotCompetency[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: Record<string, unknown>) => ({
    id: String(c.id),
    name: typeof c.name === "string" ? c.name : "",
    description: typeof c.description === "string" ? c.description : "",
    questions: Array.isArray(c.questions) ? (c.questions as unknown[]).filter((q): q is string => typeof q === "string") : [],
  }));
}

/**
 * The kit for the session member (IV-REQ-034), through `get_interview_kit`,
 * which checks the panel and the access window. Never has contact details or
 * a storage path.
 */
export async function loadInterviewKit(supabase: Db, interviewId: string): Promise<KitResult> {
  const { data, error } = await supabase.rpc("get_interview_kit", { p_interview_id: interviewId });
  if (error) throw new Error(`Couldn't load the interview kit: ${error.message}`);
  const r = data as unknown as RawKit | null;
  if (!r?.ok) {
    const reason = r?.reason === "expired" ? "expired" : "not_found";
    return { ok: false, reason, error: scorecardMessage(reason) };
  }
  const i = r.interview;
  const base: KitInterviewBase = {
    id: i.id,
    name: i.name,
    status: i.status,
    startsAt: i.starts_at ?? null,
    endsAt: i.ends_at ?? null,
    competencies: competencies(i.competencies),
  };
  if (r.access === "scorecard_only") {
    return { ok: true, kit: { access: "scorecard_only", interview: base, scorecard: cardOf(r.scorecard)! } };
  }
  return {
    ok: true,
    kit: {
      access: "kit",
      interview: {
        ...base,
        applicationId: i.application_id,
        durationMinutes: i.duration_minutes,
        meetingUrl: i.meeting_url ?? null,
        instructions: i.instructions ?? "",
        panel: (i.panel ?? []).map((p) => ({
          userId: p.user_id,
          name: p.name ?? "Teammate",
        })),
      },
      job: { id: r.job.id, title: r.job.title, questions: r.job.questions ?? null },
      candidate: { name: r.candidate?.name ?? "Candidate", hasResume: !!r.candidate?.has_resume },
      application: {
        answers: r.application?.answers ?? null,
        answersV2: r.application?.answers_v2 ?? null,
        formSnapshot: r.application?.form_snapshot ?? null,
      },
      scorecard: cardOf(r.scorecard),
    },
  };
}
