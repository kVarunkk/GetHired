import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { requireCompany } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { SCREENING_VIEW_COLUMNS, toScreeningView } from "@/helpers/matching/screening-view";

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

/**
 * One application's screening, for the company that owns the job
 * (MT-TASK-023). Polled by the screening card while it's queued or
 * processing. Another company's application is a 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireCompany({ permission: "applicants.view" });
  if (!auth.ok) return auth.response;
  const { supabase, company } = auth;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const { data: application, error } = await supabase
    .from("applications")
    .select("id, job_postings!inner(company_id)")
    .eq("id", id)
    .eq("job_postings.company_id", company.id)
    .maybeSingle();
  if (error) {
    reportError("[applications/screening] couldn't load the application", error.message);
    return NextResponse.json({ error: "Couldn't load the screening." }, { status: 500 });
  }
  if (!application) return notFound();

  const { data: screening, error: screeningError } = await supabase
    .from("application_screenings")
    .select(SCREENING_VIEW_COLUMNS)
    .eq("application_id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (screeningError) {
    reportError("[applications/screening] couldn't load the screening", screeningError.message);
    return NextResponse.json({ error: "Couldn't load the screening." }, { status: 500 });
  }

  return NextResponse.json({ screening: screening ? toScreeningView(screening) : null });
}
