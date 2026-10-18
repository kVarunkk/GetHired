import { NextRequest, NextResponse } from "next/server";
import { companyAllows, requireCompany } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { getInterviewFunnel } from "@/helpers/interview/screening/funnel";

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

/**
 * A job's AI interview config and funnel (SI-REQ-004), for the job post
 * page. Needs interviews.view on the job.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await requireCompany({ permission: "interviews.view" });
  if (!auth.ok) return auth.response;

  const { job_id: jobPostId } = await params;
  if (!isUuid(jobPostId)) return notFound();
  const denied = companyAllows(auth.company, { permission: "interviews.view", jobId: jobPostId });
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const { data: job } = await auth.supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!job) return notFound();

  const [config, funnel] = await Promise.all([
    getInterviewConfig(auth.supabase, jobPostId),
    getInterviewFunnel(auth.supabase, jobPostId),
  ]);
  return NextResponse.json({ config, funnel });
}
