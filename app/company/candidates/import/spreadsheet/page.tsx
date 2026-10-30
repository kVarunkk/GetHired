import { unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SpreadsheetImport from "@/components/candidates/SpreadsheetImport";
import { loadImportPage } from "@/helpers/candidates/import-page";
import { requireCandidatesImport } from "@/helpers/candidates/import-section";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import a spreadsheet",
};

/**
 * Imports a spreadsheet of candidates (BI-REQ-010–019) into your
 * candidates, a talent list or a job.
 */
export default async function ImportSpreadsheetPage() {
  try {
    const { supabase, company } = await requireCandidatesImport();
    const page = await loadImportPage(supabase, company);
    return page ? (
      <SpreadsheetImport page={page} />
    ) : (
      <p className="rounded-xl border p-6 text-sm text-muted-foreground">{forbiddenMessage("applicants.import")}</p>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
