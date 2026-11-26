import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import CandidateForm from "@/components/candidates/CandidateForm";
import { requireJobImport } from "@/helpers/candidates/import-section";
import { loadNewCandidatePage } from "@/helpers/candidates/new-candidate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Add candidate",
};

/** One person into the job (BI-REQ-009, CP-REQ-021). Cancel goes back to the job's applications. */
export default async function JobImportFormPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    const { supabase, company } = await requireJobImport(job_id);
    const page = await loadNewCandidatePage(supabase, company, job_id);
    if (!page || page.notFound) notFound();
    return <CandidateForm page={page} cancelHref={`/company/job-posts/${job_id}/applications`} />;
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
