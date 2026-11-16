import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { applicationPath } from "@/helpers/applications/application-page";
import { kitPath } from "./feedback-emails";

/** How many follow-ups the dashboard shows. */
export const FOLLOW_UP_LIMIT = 10;

export type InterviewFollowUp = {
  kind: "feedback_overdue" | "awaiting_candidate";
  interviewId: string;
  interviewName: string;
  candidateName: string;
  jobPostId: string;
  jobTitle: string;
  /** When it ended (feedback) or when the link was sent. */
  since: string;
  /** Scorecards still owed (feedback only). */
  owed: number;
  /** The member owes one of them: the link goes to their kit. */
  mine: boolean;
  href: string;
};

/**
 * The dashboard's interview follow-ups (IVT-074, IV-REQ-041), through
 * `interviews_needing_attention`, which scopes them to the member: overdue
 * feedback on jobs with scheduling.view or that they owe, and links nobody
 * booked. Throws on a database error.
 */
export async function loadInterviewFollowUps(supabase: SupabaseClient<Database>): Promise<InterviewFollowUp[]> {
  const { data, error } = await supabase.rpc("interviews_needing_attention", { p_limit: FOLLOW_UP_LIMIT });
  if (error) throw new Error(`Failed to load the interview follow-ups: ${error.message}`);
  return (data ?? [])
    .filter((row) => row.kind === "feedback_overdue" || row.kind === "awaiting_candidate")
    .map((row) => ({
      kind: row.kind as InterviewFollowUp["kind"],
      interviewId: row.interview_id,
      interviewName: row.interview_name,
      candidateName: row.candidate_name || "The candidate",
      jobPostId: row.job_post_id,
      jobTitle: row.job_title,
      since: row.since,
      owed: row.owed,
      mine: row.mine,
      href: row.mine ? kitPath(row.interview_id) : `${applicationPath(row.application_id)}/interviews`,
    }));
}
