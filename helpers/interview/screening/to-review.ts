import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationPersonOrNull,
  COMPANY_CANDIDATE_PERSON_COLUMNS,
} from "@/helpers/applications/application-person";
import type { ScreeningToReview } from "@/helpers/company-dashboard/summary";
import { isReviewed } from "@/helpers/interview/screening/reviewed";
import type { Database } from "@/utils/types/database.types";

/** How many recently completed interviews are checked. */
const SCAN_LIMIT = 200;

/**
 * CD-REQ-020: completed screening interviews nobody has acted on, longest
 * waiting first: the report is ready, nobody marked it reviewed since the
 * interview finished, and the application hasn't moved since then either, so a
 * stage move clears it too. Reads through RLS, so a member sees only the jobs where they have
 * interviews.view. Merged applications are left out. Throws on a database
 * error.
 */
export async function listScreeningsToReview(
  supabase: SupabaseClient<Database>,
  { limit }: { limit: number },
): Promise<ScreeningToReview[]> {
  const { data: rows, error } = await supabase
    .from("application_interviews")
    .select(
      `id, application_id, interview_id, completed_at, company_reviewed_at, applications!inner(stage_entered_at, merged_into_application_id, applicant_user_id, company_candidate_id, user_info(full_name), ${COMPANY_CANDIDATE_PERSON_COLUMNS}, job_postings!inner(id, title))` as const,
    )
    .eq("status", "completed")
    .is("applications.merged_into_application_id", null)
    .order("completed_at", { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) throw new Error(`Couldn't load the finished interviews: ${error.message}`);

  const unmoved = (rows ?? []).filter(
    (r) =>
      r.interview_id &&
      r.completed_at &&
      !isReviewed(r.company_reviewed_at, r.completed_at) &&
      Date.parse(r.applications.stage_entered_at) <= Date.parse(r.completed_at),
  );
  if (unmoved.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from("interview_sessions")
    .select("id, interview_id")
    .in(
      "interview_id",
      unmoved.map((r) => r.interview_id as string),
    )
    .eq("status", "completed");
  if (sessionsError) throw new Error(`Couldn't load the interview sessions: ${sessionsError.message}`);
  if (!sessions || sessions.length === 0) return [];

  const { data: analyses, error: analysesError } = await supabase
    .from("interview_analyses")
    .select("interview_session_id")
    .in(
      "interview_session_id",
      sessions.map((s) => s.id),
    )
    .eq("perspective", "company")
    .eq("status", "completed");
  if (analysesError) throw new Error(`Couldn't load the interview reports: ${analysesError.message}`);

  const analysed = new Set((analyses ?? []).map((a) => a.interview_session_id));
  const ready = new Set(sessions.filter((s) => analysed.has(s.id)).map((s) => s.interview_id));

  return unmoved
    .filter((r) => ready.has(r.interview_id as string))
    .reverse()
    .slice(0, limit)
    .map((r) => ({
      interviewId: r.id,
      applicationId: r.application_id,
      candidateName: applicationPersonOrNull(r.applications)?.name ?? "Applicant",
      jobPostId: r.applications.job_postings.id,
      jobTitle: r.applications.job_postings.title,
      completedAt: r.completed_at as string,
    }));
}
