import { after, NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { readResume } from "@/helpers/resume/read-resume";
import { buildResumeDocument } from "@/helpers/resume/render/document";
import { isExportFormat, resumeDownload } from "@/helpers/resume/render/export-response";
import { ResumePdfCharactersError } from "@/helpers/resume/render/pdf";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { PostHogEvent } from "@/utils/types";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** RE-REQ-050: renders the user's resume as a download. Nothing is stored. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ resume_id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return fail("Unauthorized", 401);

  const format = request.nextUrl.searchParams.get("format");
  if (!isExportFormat(format)) return fail("Choose pdf or docx.", 400);

  const { resume_id: resumeId } = await params;
  if (!isUuid(resumeId)) return fail("Resume not found.", 404);

  try {
    const supabase = await createClient();
    const readRow = () =>
      supabase
        .from("resumes")
        .select("id, name, content, contact, template, revision, schema_version, resume_path")
        .eq("id", resumeId)
        .eq("user_id", user.id)
        .maybeSingle();

    let { data: row, error } = await readRow();
    if (error) throw error;
    if (!row) return fail("Resume not found.", 404);

    if (row.schema_version === 1) {
      const upgraded = await upgradeResumeFromFile(row);
      if (!upgraded.ok) return fail(upgraded.error, 409);

      ({ data: row, error } = await readRow());
      if (error) throw error;
      if (!row) return fail("Resume not found.", 404);
    }

    const resume = readResume(row);
    if (!resume.hasContent) return fail("This resume has nothing to export yet.", 409);

    const document = buildResumeDocument({
      contact: resume.contact ?? { fullName: "", links: [] },
      content: resume.content,
      template: resume.template,
    });

    const download = await resumeDownload(document, resume.name, format);

    after(() =>
      eventCaptureServer({
        event: PostHogEvent.ResumeExported,
        distinctId: user.id,
        properties: { format, template: resume.template, surface: "page" },
      }),
    );

    return download;
  } catch (error) {
    if (error instanceof ResumePdfCharactersError) return fail(error.message, 422);
    reportError("[RESUME_EXPORT_FAILED]:", error);
    return fail("We couldn't export this resume. Please try again.", 500);
  }
}
