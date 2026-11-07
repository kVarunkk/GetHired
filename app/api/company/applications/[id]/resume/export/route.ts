import { NextRequest, NextResponse } from "next/server";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { readResumeSnapshot, snapshotDocument } from "@/helpers/applications/resume-snapshot";
import { reportError } from "@/helpers/posthog/report-error";
import { isExportFormat, resumeDownload } from "@/helpers/resume/render/export-response";
import { ResumePdfCharactersError } from "@/helpers/resume/render/pdf";

const NOT_FOUND = "Resume not found.";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * RE-REQ-063: what an applicant sent, as a download. The access is the
 * application's resume page's: RLS lets only the job's company read the row. A
 * company's imported candidate has their file instead, so nothing here.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const format = request.nextUrl.searchParams.get("format");
  if (!isExportFormat(format)) return fail("Choose pdf or docx.", 400);

  try {
    const { id: applicationId } = await params;
    const frame = await loadApplicationFrame(applicationId);
    if (!frame || frame.person.kind !== "user") return fail(NOT_FOUND, 404);

    const { data, error } = await frame.supabase
      .from("applications")
      .select("resume_snapshot, resume_contact_snapshot")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;

    const snapshot = readResumeSnapshot(data?.resume_snapshot);
    if (!snapshot) return fail(NOT_FOUND, 404);

    return await resumeDownload(snapshotDocument(snapshot, data?.resume_contact_snapshot), frame.person.name, format);
  } catch (error) {
    if (error instanceof ResumePdfCharactersError) return fail(error.message, 422);
    reportError("[APPLICATION_RESUME_EXPORT_FAILED]:", error);
    return fail("We couldn't export this resume. Please try again.", 500);
  }
}
