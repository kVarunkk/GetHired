import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SpreadsheetImport from "@/components/candidates/SpreadsheetImport";
import { loadImportPage } from "@/helpers/candidates/import-page";
import { requireJobImport } from "@/helpers/candidates/import-section";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import a spreadsheet",
};

/** A spreadsheet or another ATS's export into the job (BI-REQ-010–019, CP-REQ-021). */
export default async function JobImportSpreadsheetPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    const { supabase, company } = await requireJobImport(job_id);
    const page = await loadImportPage(supabase, company, { jobId: job_id });
    if (!page || page.notFound) notFound();
    return <SpreadsheetImport page={page} />;
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
