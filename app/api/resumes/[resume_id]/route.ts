import { reportError } from "@/helpers/posthog/report-error";
import { getResumeDetails } from "@/helpers/resumes/get-resume-details";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resume_id: string }> },
) {
  try {
    const { resume_id: resumeId } = await params;
    if (!resumeId) {
      return NextResponse.json(
        { error: "Missing resume_id parameter." },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resume = await getResumeDetails(supabase, user, resumeId);
    if (!resume) {
      return NextResponse.json({ error: "Resume not found." }, { status: 404 });
    }

    return NextResponse.json({ data: resume });
  } catch (error) {
    reportError("[resumes] couldn't load the resume", error);
    return NextResponse.json(
      { error: "An error occurred while fetching resume details." },
      { status: 500 },
    );
  }
}
