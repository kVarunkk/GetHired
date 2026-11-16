import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/helpers/agent/auth";
import { requireCompany } from "@/helpers/companies/require-company";
import { signKitResume } from "@/helpers/interviews/kit-resume";
import { reportError } from "@/helpers/posthog/report-error";

type Params = { params: Promise<{ interview_id: string }> };

/**
 * GET (IVT-019, IV-REQ-034): the candidate's resume file for the interview
 * kit. Redirects to a 5-minute signed URL after `can_open_interview_kit`
 * passed for the session member, so the kit never holds a storage path.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;

  const { interview_id: interviewId } = await params;
  if (!isUuid(interviewId)) return NextResponse.json({ error: "Interview not found." }, { status: 404 });

  try {
    const url = await signKitResume(auth.supabase, interviewId);
    if (!url) return NextResponse.json({ error: "You can't open this resume." }, { status: 403 });
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    reportError(err, { where: "interview-kit-resume" });
    return NextResponse.json({ error: "Couldn't open the resume." }, { status: 500 });
  }
}
