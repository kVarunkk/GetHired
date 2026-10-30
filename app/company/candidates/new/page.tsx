import { redirect, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import CandidateForm from "@/components/candidates/CandidateForm";
import PageHeader from "@/components/PageHeader";
import { requireCandidatesImport } from "@/helpers/candidates/import-section";
import { CANDIDATES_LIST_PATH, jobImportPath } from "@/helpers/candidates/paths";
import { loadNewCandidatePage } from "@/helpers/candidates/new-candidate";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Add candidate",
};

/**
 * Adds one candidate by hand (BI-REQ-009) to your candidates, a talent list
 * or a job. `?job=` (older links, `newCandidatePath(jobId)`) goes to that
 * job's Import candidates section when the member can import into it, and
 * is ignored otherwise (CP-REQ-032).
 */
export default async function NewCandidatePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  try {
    const { job } = await searchParams;
    const { supabase, company } = await requireCandidatesImport();

    const page = await loadNewCandidatePage(supabase, company, job);
    if (page?.fixedJob) redirect(jobImportPath(page.fixedJob.id, "form"));

    return (
      <div className="flex flex-col gap-6 p-4 pb-0">
        <PageHeader
          title="Add candidate"
          description="Someone you're already talking to: a referral, or a resume someone emailed you."
          backHref={CANDIDATES_LIST_PATH}
        />
        {page ? (
          <CandidateForm page={{ ...page, fixedJob: null }} cancelHref={CANDIDATES_LIST_PATH} />
        ) : (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">
            {forbiddenMessage("applicants.import")}
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
