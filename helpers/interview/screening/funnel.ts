import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export type InterviewFunnel = {
  /** Everyone invited to the job's interview, whatever happened next. */
  invited: number;
  /** Invited and not started yet, or paused for an accommodation request. */
  waiting: number;
  inProgress: number;
  completed: number;
  expired: number;
  declined: number;
  /** Mean of the completed reports' overall scores (1–5, one decimal), or null. */
  avgScore: number | null;
};

/**
 * The job page's interview funnel (SI-REQ-004). Reads through RLS, so the
 * caller sees it with interviews.view on the job.
 */
export async function getInterviewFunnel(supabase: SupabaseClient<Database>, jobPostId: string): Promise<InterviewFunnel> {
  const { data: rows, error } = await supabase
    .from("application_interviews")
    .select("status, interview_id")
    .eq("job_post_id", jobPostId);
  if (error) throw new Error(`Couldn't load the interview funnel: ${error.message}`);

  const all = rows ?? [];
  const count = (...statuses: string[]) => all.filter((r) => statuses.includes(r.status)).length;
  const completedInterviews = all
    .filter((r) => r.status === "completed" && r.interview_id)
    .map((r) => r.interview_id as string);

  let avgScore: number | null = null;
  if (completedInterviews.length > 0) {
    const { data: sessions } = await supabase
      .from("interview_sessions")
      .select("id")
      .in("interview_id", completedInterviews)
      .eq("status", "completed");
    const sessionIds = (sessions ?? []).map((s) => s.id);
    if (sessionIds.length > 0) {
      const { data: analyses } = await supabase
        .from("interview_analyses")
        .select("result")
        .in("interview_session_id", sessionIds)
        .eq("perspective", "company")
        .eq("status", "completed");
      const scores = (analyses ?? [])
        .map((a) => (a.result as { overallScore?: unknown } | null)?.overallScore)
        .filter((s): s is number => typeof s === "number");
      if (scores.length > 0) {
        avgScore = Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
      }
    }
  }

  return {
    invited: all.length,
    waiting: count("invited", "paused"),
    inProgress: count("in_progress"),
    completed: count("completed"),
    expired: count("expired"),
    declined: count("declined"),
    avgScore,
  };
}
