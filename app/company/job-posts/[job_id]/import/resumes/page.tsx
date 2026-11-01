import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import ResumeImport from "@/components/candidates/ResumeImport";
import { requireJobImport } from "@/helpers/candidates/import-section";
import { loadResumeImportPage } from "@/helpers/candidates/resume-import-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import resumes",
};

/** A folder of resumes into the job (BI-REQ-020–025, CP-REQ-021). */
export default async function JobImportResumesPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    const { supabase, user, company } = await requireJobImport(job_id);
    const page = await loadResumeImportPage(supabase, company, { userId: user.id, jobId: job_id });
    if (!page || page.notFound) notFound();
    return <ResumeImport key={page.open?.batch.id ?? "new"} page={page} initial={page.open} />;
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
