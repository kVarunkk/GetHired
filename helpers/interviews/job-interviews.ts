import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@/utils/types/database.types";
import { KIT_GRACE_DAYS } from "./config";
import type { InterviewStatus } from "./interviews";

type Db = SupabaseClient<Database>;

/** How many interviews a job-wide list returns. */
export const JOB_INTERVIEWS_LIMIT = 30;

export type JobInterviewSeat = {
  userId: string;
  name: string;
  response: Enums<"interview_panel_response">;
  scorecardStatus: "none" | "draft" | "submitted";
};

export type JobInterview = {
  id: string;
  applicationId: string;
  /** Candidate-written: callers sandbox it. */
  candidateName: string;
  name: string;
  status: InterviewStatus;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  panel: JobInterviewSeat[];
  /** Panel members who still owe a scorecard on a started interview. */
  feedbackOwedBy: string[];
};

type Row = {
  id: string;
  application_id: string;
  name: string;
  status: InterviewStatus;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number;
  applications: {
    user_info: { full_name: string | null } | null;
    company_candidates: { full_name: string | null } | null;
  } | null;
};

/**
 * IV-REQ-052: a job's open interviews: links waiting on the candidate,
 * booked ones, and completed ones whose scorecards can still be written (7
 * days after the end), soonest first. Each comes with its panel's scorecard
 * state from `list_interview_scorecards`, which never returns content to a
 * blind reader, and this keeps only the status. Merged applications are
 * left out. Reads through RLS (`scheduling.view` on the job), so it's empty
 * without access.
 */
export async function listJobInterviews(
  supabase: Db,
  jobPostId: string,
  { now = new Date(), limit = JOB_INTERVIEWS_LIMIT }: { now?: Date; limit?: number } = {},
): Promise<JobInterview[]> {
  const since = new Date(now.getTime() - KIT_GRACE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("scheduled_interviews")
    .select(
      "id, application_id, name, status, starts_at, ends_at, duration_minutes, " +
        "applications!inner(merged_into_application_id, user_info(full_name), company_candidates(full_name))",
    )
    .eq("job_post_id", jobPostId)
    .is("applications.merged_into_application_id", null)
    .or(`status.in.(awaiting_candidate,scheduled),and(status.eq.completed,ends_at.gt.${since})`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Couldn't load the job's interviews: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const applicationIds = [...new Set(rows.map((r) => r.application_id))];
  const seatLists = await Promise.all(
    applicationIds.map(async (id) => {
      const { data: seats, error: seatsError } = await supabase.rpc("list_interview_scorecards", { p_application_id: id });
      if (seatsError) throw new Error(`Couldn't load scorecards: ${seatsError.message}`);
      return seats ?? [];
    }),
  );
  const seatsByInterview = new Map<string, JobInterviewSeat[]>();
  for (const s of seatLists.flat()) {
    const seat: JobInterviewSeat = {
      userId: s.author_user_id,
      name: s.author_name ?? "Teammate",
      response: s.response,
      scorecardStatus: s.status === "draft" || s.status === "submitted" ? s.status : "none",
    };
    seatsByInterview.set(s.interview_id, [...(seatsByInterview.get(s.interview_id) ?? []), seat]);
  }

  return rows.map((r) => {
    const panel = seatsByInterview.get(r.id) ?? [];
    const started = r.status === "completed" || (r.status === "scheduled" && !!r.starts_at && Date.parse(r.starts_at) <= now.getTime());
    return {
      id: r.id,
      applicationId: r.application_id,
      candidateName:
        r.applications?.company_candidates?.full_name?.trim() || r.applications?.user_info?.full_name?.trim() || "Candidate",
      name: r.name,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      durationMinutes: r.duration_minutes,
      panel,
      feedbackOwedBy: started ? panel.filter((p) => p.scorecardStatus !== "submitted").map((p) => p.name) : [],
    };
  });
}
