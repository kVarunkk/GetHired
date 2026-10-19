import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import {
  storedScreeningReportSchema,
  type Competency,
  type ConfigSnapshot,
  type StoredScreeningReport,
  type TranscriptTurn,
} from "./schemas";

export type InterviewAttempt = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  durationSeconds: number | null;
  status: string;
  turns: TranscriptTurn[];
};

/** One application's AI interview as the applicant page shows it (SI-REQ-033, SIT-063). */
export type ApplicationInterviewView = {
  id: string;
  status: string;
  jobPostId: string;
  deadlineAt: string;
  attemptsUsed: number;
  maxAttempts: number;
  attemptGranted: boolean;
  deadlineExtensions: number;
  accommodationRequest: string | null;
  invitedVia: string;
  completedAt: string | null;
  createdAt: string;
  durationMinutes: number;
  competencies: Competency[];
  questions: string[];
  attempts: InterviewAttempt[];
  /** The company report of the latest completed session. `result` is null until it's done, or if it doesn't parse. */
  report: { status: string; sessionId: string; result: StoredScreeningReport | null } | null;
};

/**
 * The interview of one application, its attempts (with transcripts) and the
 * company report. Reads through RLS, so it's null without interviews.view
 * on the job.
 */
export async function getApplicationInterview(
  supabase: SupabaseClient<Database>,
  applicationId: string,
): Promise<ApplicationInterviewView | null> {
  const { data: row, error } = await supabase
    .from("application_interviews")
    .select(
      "id, status, job_post_id, interview_id, deadline_at, attempts_used, max_attempts, attempt_granted, deadline_extensions, accommodation_request, invited_via, completed_at, created_at, config_snapshot",
    )
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the interview: ${error.message}`);
  if (!row) return null;

  const snapshot = row.config_snapshot as unknown as ConfigSnapshot;
  let attempts: InterviewAttempt[] = [];
  let report: ApplicationInterviewView["report"] = null;

  if (row.interview_id) {
    const { data: sessions, error: sessionsError } = await supabase
      .from("interview_sessions")
      .select("id, started_at, ended_at, end_reason, duration_seconds, status, turns")
      .eq("interview_id", row.interview_id)
      .order("started_at", { ascending: true });
    if (sessionsError) throw new Error(`Couldn't load the interview sessions: ${sessionsError.message}`);
    attempts = (sessions ?? []).map((s) => ({
      id: s.id,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      endReason: s.end_reason,
      durationSeconds: s.duration_seconds,
      status: s.status,
      turns: (Array.isArray(s.turns) ? s.turns : []) as unknown as TranscriptTurn[],
    }));

    const completedIds = attempts.filter((a) => a.status === "completed").map((a) => a.id);
    if (completedIds.length > 0) {
      const { data: analyses, error: analysesError } = await supabase
        .from("interview_analyses")
        .select("interview_session_id, status, result")
        .in("interview_session_id", completedIds)
        .eq("perspective", "company");
      if (analysesError) throw new Error(`Couldn't load the interview report: ${analysesError.message}`);
      // The latest completed session's report.
      const latest = [...completedIds]
        .reverse()
        .map((id) => (analyses ?? []).find((a) => a.interview_session_id === id))
        .find(Boolean);
      if (latest) {
        const parsed = latest.status === "completed" ? storedScreeningReportSchema.safeParse(latest.result) : null;
        report = {
          status: latest.status,
          sessionId: latest.interview_session_id,
          result: parsed?.success ? parsed.data : null,
        };
      }
    }
  }

  return {
    id: row.id,
    status: row.status,
    jobPostId: row.job_post_id,
    deadlineAt: row.deadline_at,
    attemptsUsed: row.attempts_used,
    maxAttempts: row.max_attempts,
    attemptGranted: row.attempt_granted,
    deadlineExtensions: row.deadline_extensions,
    accommodationRequest: row.accommodation_request,
    invitedVia: row.invited_via,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    durationMinutes: snapshot?.duration_minutes ?? 0,
    competencies: snapshot?.competencies ?? [],
    questions: (snapshot?.questions ?? []).map((q) => q.text),
    attempts,
    report,
  };
}
