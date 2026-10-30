import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deleteCandidateFiles, releaseRowHolds } from "@/helpers/candidates/resume-import";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/** Rows cleared per run; the rest wait for the next day. */
const MAX_ROWS = 1000;

/**
 * Daily (BI-REQ-026, BI-SEC-007): once a resume batch's 7 days are up, its
 * files that no candidate kept are deleted from Storage, their rows deleted
 * and any holds left released. That covers a batch never confirmed (which
 * becomes `expired`) and a confirmed batch's leftovers (failed or unparsed
 * files). Confirmed rows, whose files are candidates' resumes, are never
 * touched.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("candidate_import_rows")
    .select("id, company_id, file_path, candidate_import_batches!inner(expires_at)")
    .neq("status", "confirmed")
    .lt("candidate_import_batches.expires_at", now)
    .limit(MAX_ROWS);
  if (error) {
    reportError("[candidate imports expire] couldn't load the rows", error.message);
    return NextResponse.json({ message: "Couldn't load the rows." }, { status: 500 });
  }

  const failures: string[] = [];
  const stale = rows ?? [];
  if (stale.length > 0) {
    // A staged spreadsheet row has no file.
    await deleteCandidateFiles(stale.flatMap((r) => (r.file_path ? [r.file_path] : [])));
    const byCompany = new Map<string, string[]>();
    for (const r of stale) byCompany.set(r.company_id, [...(byCompany.get(r.company_id) ?? []), r.id]);
    for (const [companyId, ids] of byCompany) await releaseRowHolds(companyId, ids);

    const { error: deleteError } = await admin
      .from("candidate_import_rows")
      .delete()
      .in(
        "id",
        stale.map((r) => r.id),
      );
    if (deleteError) failures.push(`couldn't delete ${stale.length} rows: ${deleteError.message}`);
  }

  const { data: expired, error: expireError } = await admin
    .from("candidate_import_batches")
    .update({ status: "expired" })
    .lt("expires_at", now)
    .in("status", ["draft", "parsing", "ready"])
    .select("id");
  if (expireError) failures.push(`couldn't expire batches: ${expireError.message}`);

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(`[CANDIDATE IMPORTS EXPIRE] ${failures.join("\n")}`);
  }
  return NextResponse.json({ rows: stale.length, batches: expired?.length ?? 0, failed: failures.length });
}
