import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { hashSchedulingToken, newSchedulingToken, schedulingPath } from "./scheduling-token";

// The applicant's interviews with people (IVT-064, IV-REQ-043), read only
// through my_scheduled_interviews(): no plan snapshot, panel or scorecards.
// Applicant code never reads scheduled_interviews itself
// (test/applicant-scheduled-interviews.test.ts).

type Db = SupabaseClient<Database>;

type MyScheduledInterviewRow = Database["public"]["Functions"]["my_scheduled_interviews"]["Returns"][number];

// The generator types every returned column as non-null, but a link the
// candidate hasn't booked yet has no times, and a recorded interview may have
// no meeting link.
export type MyScheduledInterview = Omit<MyScheduledInterviewRow, "starts_at" | "ends_at" | "meeting_url"> & {
  starts_at: string | null;
  ends_at: string | null;
  meeting_url: string | null;
};

/**
 * Upcoming interviews: a link waiting for a time, or a booked time that hasn't
 * ended. A failure reads as none. One render reads them once.
 */
export const listMyScheduledInterviews = cache(async (supabase: Db): Promise<MyScheduledInterview[]> => {
  const { data, error } = await supabase.rpc("my_scheduled_interviews");
  if (error) {
    reportError("[interviews] couldn't list my scheduled interviews", error.message);
    return [];
  }
  return data ?? [];
});

/**
 * The applicant's own self-scheduling page for an interview they can still
 * pick or move a time for. Only hashes are stored, so this makes a new token
 * (the emailed one stops working) and returns the page's path.
 */
export async function openMySchedulingLink(
  supabase: Db,
  interviewId: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const token = newSchedulingToken();
  const { data, error } = await supabase.rpc("rotate_my_scheduling_link", {
    p_interview_id: interviewId,
    p_token_hash: hashSchedulingToken(token),
  });
  const result = data as { ok?: boolean } | null;
  if (error || !result?.ok) {
    if (error) reportError("[interviews] couldn't open my scheduling link", error.message);
    return { ok: false, error: "This interview can't be changed here any more. Reply to the company's email or calendar invite." };
  }
  return { ok: true, path: schedulingPath(token) };
}
