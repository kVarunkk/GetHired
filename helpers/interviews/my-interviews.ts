import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyInterview } from "./my-interviews-view";

export type { MyInterview } from "./my-interviews-view";

/**
 * The session member's panel seats (IVT-021) through `list_my_interviews`,
 * which needs no permission: a member whose role grants nothing still sees
 * the interviews they're on. Merged applications are left out.
 */
export async function listMyInterviews(supabase: SupabaseClient<Database>): Promise<MyInterview[]> {
  const { data, error } = await supabase.rpc("list_my_interviews");
  if (error) throw new Error(`Couldn't load your interviews: ${error.message}`);
  return (data ?? []).map((r) => ({
    interviewId: r.interview_id,
    applicationId: r.application_id,
    jobTitle: r.job_title,
    candidateName: r.candidate_name,
    name: r.name,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    meetingUrl: r.meeting_url,
    scorecardStatus: (r.scorecard_status === "draft" || r.scorecard_status === "submitted"
      ? r.scorecard_status
      : "none") as MyInterview["scorecardStatus"],
    kitOpen: r.kit_open,
  }));
}
