import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import PoolMatchesCard, { POOL_MATCHES_TITLE } from "@/components/candidates/PoolMatchesCard";
import { isUuid } from "@/helpers/agent/auth";
import { loadPoolMatchesCard } from "@/helpers/candidates/pool-matches-card";
import { candidateImportPath } from "@/helpers/candidates/paths";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: POOL_MATCHES_TITLE,
};

/**
 * CP-REQ-060: the company's own candidates who may fit this job, for
 * talent.view and jobs.view on it. A section of the job's layout.
 */
export default async function JobPoolMatchesPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "talent.view") || !can(company, "jobs.view", job_id)) notFound();

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    // Null when the company has no embedded candidates yet, or matching failed.
    const card = await loadPoolMatchesCard(supabase, company, job.id);

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title={POOL_MATCHES_TITLE}
          description="People you've imported whose profile is close to this job. Adding them emails no one."
        />
        {card ? (
          <PoolMatchesCard jobId={job.id} status={card.status} matches={card.matches} stages={card.stages} />
        ) : (
          <p className="text-sm text-muted-foreground">
            There are no candidates to match yet.
            {can(company, "applicants.import") && (
              <>
                {" "}
                <Link href={candidateImportPath()} className="font-medium underline underline-offset-4">
                  Import candidates
                </Link>{" "}
                to see who may fit.
              </>
            )}
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
