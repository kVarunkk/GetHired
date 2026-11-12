"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { RESUME_BUCKET } from "@/helpers/candidates/resume-files";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z.object({ rowId: z.string().uuid() }).strict();

/** Long enough to open the file; the grid asks again on the next View. */
const SIGNED_URL_SECONDS = 10 * 60;

export type ImportRowFileUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * SERVER ACTION: a short-lived link to a resume batch's uploaded file, for the
 * review grid's View (a PDF) or Download (a Word file). The row is read
 * through RLS, so only members who can see the batch get a link, and only for
 * the session company's rows; the file is then signed with the service role.
 */
export async function importRowFileUrlAction(input: z.input<typeof inputSchema>): Promise<ImportRowFileUrlResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };

  const { data: row } = await auth.supabase
    .from("candidate_import_rows")
    .select("file_path, file_name, status")
    .eq("id", parsed.data.rowId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!row?.file_path || row.status === "removed") return { ok: false, error: importMessage("not_found") };

  const isPdf = row.file_path.toLowerCase().endsWith(".pdf");
  const { data, error } = await createServiceRoleClient()
    .storage.from(RESUME_BUCKET)
    .createSignedUrl(row.file_path, SIGNED_URL_SECONDS, isPdf ? undefined : { download: row.file_name });
  if (error || !data?.signedUrl) {
    reportError("[import row file] couldn't sign the file", error?.message);
    return { ok: false, error: "Couldn't open the resume. Try again." };
  }
  return { ok: true, url: data.signedUrl };
}
