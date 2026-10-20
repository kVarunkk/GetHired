import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

const DEFAULT_RETENTION_DAYS = 365;
const JOB_BATCH = 200;

/**
 * Monthly (SI-SEC-008, SI-DEC-006): deletes the screening transcripts, and
 * with them the company reports, of jobs closed more than SI_RETENTION_DAYS
 * ago. A job counts as closed since its last update while inactive (there's
 * no closed-at column). The application_interviews rows stay as the status
 * history. Practice interviews are never touched. Account deletion already
 * cascades. Called by the scheduler with X-Internal-Secret.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const days = Number(process.env.SI_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const admin = createServiceRoleClient();

  try {
    const { data: jobs, error: jobsError } = await admin
      .from("job_postings")
      .select("id")
      .eq("status", "inactive")
      .lt("updated_at", cutoff)
      .limit(JOB_BATCH);
    if (jobsError) throw new Error(`jobs: ${jobsError.message}`);
    const jobIds = (jobs ?? []).map((j) => j.id);
    if (jobIds.length === 0) return NextResponse.json({ jobs: 0, sessions: 0 });

    const { data: interviews, error: interviewsError } = await admin
      .from("application_interviews")
      .select("interview_id")
      .in("job_post_id", jobIds)
      .not("interview_id", "is", null);
    if (interviewsError) throw new Error(`interviews: ${interviewsError.message}`);
    const interviewIds = (interviews ?? []).map((i) => i.interview_id).filter((id): id is string => !!id);
    if (interviewIds.length === 0) return NextResponse.json({ jobs: jobIds.length, sessions: 0 });

    const { error: deleteError, count } = await admin
      .from("interview_sessions")
      .delete({ count: "exact" })
      .in("interview_id", interviewIds);
    if (deleteError) throw new Error(`sessions: ${deleteError.message}`);

    return NextResponse.json({ jobs: jobIds.length, sessions: count ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendEmailForStatusUpdate(`SCREENING RETENTION CRON FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}

export const POST = GET;
