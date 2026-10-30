import { unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import ResumeImport from "@/components/candidates/ResumeImport";
import { requireCandidatesImport } from "@/helpers/candidates/import-section";
import { loadResumeImportPage } from "@/helpers/candidates/resume-import-page";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import resumes",
};

/** A folder of resumes into your candidates, a talent list or a job (CP-REQ-002/031). */
export default async function ImportResumesPage() {
  try {
    const { supabase, user, company } = await requireCandidatesImport();
    const page = await loadResumeImportPage(supabase, company, { userId: user.id });
    return page ? (
      <ResumeImport key={page.open?.batch.id ?? "new"} page={page} initial={page.open} />
    ) : (
      <p className="rounded-xl border p-6 text-sm text-muted-foreground">{forbiddenMessage("applicants.import")}</p>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
