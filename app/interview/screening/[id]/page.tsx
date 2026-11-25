import { notFound, unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import ScreeningInterviewView from "@/components/interviews/ScreeningInterviewView";
import { getMyScreeningInterview } from "@/helpers/interview/screening/my-interviews";
import { effectiveStatus } from "@/helpers/interview/screening/dashboard-state";
import { isUuid } from "@/helpers/agent/auth";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Screening Interview",
  robots: { index: false, follow: false },
};

/**
 * The candidate's screening interview (SIT-053). Applicant-only (middleware).
 * Read through my_screening_interviews(), so another user's id is not found
 * and the questions never reach the browser.
 */
export default async function ScreeningInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  try {
    const supabase = await createClient();
    const invite = await getMyScreeningInterview(supabase, id);
    if (!invite) notFound();

    // The candidate reads their own screening interview and its sessions (turns only).
    const { data: interview, error } = await supabase
      .from("interviews")
      .select("*, all_jobs(job_name), resumes(name), interview_sessions(id, turns, started_at, status)")
      .eq("id", invite.interview_id)
      .maybeSingle();
    if (error) throw error;

    const sessionHistory = (interview?.interview_sessions ?? []).map((s) => ({
      id: s.id,
      started_at: s.started_at,
      status: s.status,
      analysisStatus: null,
    }));

    // Past its deadline but not yet expired by the job: show it as expired.
    const shown = { ...invite, status: effectiveStatus(invite) };
    return <ScreeningInterviewView invite={shown} interview={interview} sessionHistory={sessionHistory} />;
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
