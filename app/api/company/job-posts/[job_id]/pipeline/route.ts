import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { companyAllows, requireCompany } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { loadBoard } from "@/helpers/pipeline/board";

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

/**
 * The pipeline board for one of the company's jobs (PL-TASK-011): its active
 * stages and one card per application, for the board's refresh after a move.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const auth = await requireCompany({ permission: "applicants.view" });
  if (!auth.ok) return auth.response;

  const { job_id: jobPostId } = await params;
  if (!isUuid(jobPostId)) return notFound();
  // RP-REQ-010: scope assigned covers only the member's own jobs.
  const denied = companyAllows(auth.company, { permission: "applicants.view", jobId: jobPostId });
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  try {
    const result = await loadBoard(auth, jobPostId);
    if (!result.ok) return notFound();
    return NextResponse.json(result.data);
  } catch (error) {
    reportError("Failed to load the pipeline board:", error);
    return NextResponse.json({ error: "Couldn't load the pipeline." }, { status: 500 });
  }
}
