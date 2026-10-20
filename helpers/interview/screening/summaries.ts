import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { InterviewSummary } from "./summary-view";

/**
 * Each application's interview on one job, keyed by application id, for the
 * applicants list and the board (SIT-062). Reads through RLS, so a member
 * without interviews.view on the job gets an empty map. Never the report.
 */
export async function getInterviewSummaries(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<Record<string, InterviewSummary>> {
  const { data: rows, error } = await supabase
    .from("application_interviews")
    .select("id, application_id, status, interview_id")
    .eq("job_post_id", jobPostId);
  if (error) throw new Error(`Couldn't load the interviews: ${error.message}`);

  const completed = (rows ?? []).filter((r) => r.status === "completed" && r.interview_id);
  const reportByInterview = new Map<string, { status: string; overallScore: number | null }>();
  if (completed.length > 0) {
    const { data: sessions, error: sessionsError } = await supabase
      .from("interview_sessions")
      .select("id, interview_id")
      .in(
        "interview_id",
        completed.map((r) => r.interview_id as string),
      )
      .eq("status", "completed");
    if (sessionsError) throw new Error(`Couldn't load the interview sessions: ${sessionsError.message}`);

    const interviewOfSession = new Map((sessions ?? []).map((s) => [s.id, s.interview_id]));
    if (interviewOfSession.size > 0) {
      const { data: analyses, error: analysesError } = await supabase
        .from("interview_analyses")
        .select("interview_session_id, status, overallScore:result->overallScore")
        .in("interview_session_id", [...interviewOfSession.keys()])
        .eq("perspective", "company");
      if (analysesError) throw new Error(`Couldn't load the interview reports: ${analysesError.message}`);
      for (const a of analyses ?? []) {
        const interviewId = interviewOfSession.get(a.interview_session_id);
        if (!interviewId) continue;
        const score = (a as { overallScore?: unknown }).overallScore;
        reportByInterview.set(interviewId, {
          status: a.status,
          overallScore: typeof score === "number" ? score : null,
        });
      }
    }
  }

  const summaries: Record<string, InterviewSummary> = {};
  for (const row of rows ?? []) {
    const report = row.interview_id ? reportByInterview.get(row.interview_id) : undefined;
    summaries[row.application_id] = {
      id: row.id,
      status: row.status,
      overallScore: report?.status === "completed" ? report.overallScore : null,
      report: !report ? "none" : report.status === "completed" ? "ready" : "pending",
    };
  }
  return summaries;
}
