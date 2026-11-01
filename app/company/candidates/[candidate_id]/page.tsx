import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import CandidateDetailsForm from "@/components/candidates/CandidateDetailsForm";
import CandidateMatchingJobs from "@/components/candidates/CandidateMatchingJobs";
import SectionHeader from "@/components/SectionHeader";
import { candidateCanMatch } from "@/helpers/candidates/can-match";
import { loadCandidateFrame } from "@/helpers/candidates/candidate-page";
import { hasActiveJobs, listMatchingJobs } from "@/helpers/candidates/pool-matches";
import { can } from "@/helpers/companies/permissions";
import { candidateFormValues } from "@/helpers/candidates/candidate-form";
import { formatDate } from "@/utils/date";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * A candidate's overview: their details, editable with applicants.import
 * (BI-REQ-004), and their matching jobs, or a note when there's too little
 * to match them on (CP-REQ-041/062).
 */
export default async function CandidateOverviewPage({ params }: { params: Promise<{ candidate_id: string }> }) {
  try {
    const { candidate_id } = await params;
    const frame = await loadCandidateFrame(candidate_id);
    if (!frame) notFound();
    const { candidate, canEdit, company } = frame;
    const canMatch = await candidateCanMatch(frame.supabase, candidate);
    // CP-REQ-062: the RPC checks talent.view and each job's jobs.view too.
    const matching =
      canMatch && can(company, "talent.view") ? await listMatchingJobs(frame.supabase, candidate.id) : null;
    // With no active job there's nothing to match against, so the page says
    // that rather than "Finding matching jobs…" or "None is close".
    const hasOpenJobs =
      matching?.ok && (matching.status === "not_embedded" || matching.matches.length === 0)
        ? await hasActiveJobs(frame.supabase, company)
        : true;

    const source = candidate.sourceFile
      ? `Imported from ${candidate.sourceFile}`
      : candidate.source_batch_id
        ? "Added by hand"
        : "Added";

    return (
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Overview"
          description={`${source} on ${formatDate(candidate.created_at)}. Only your team sees these details.`}
        />
        {candidate.claimed_user_id && (
          <p className="rounded-xl border p-4 text-sm">
            Joined GetHired with this email
            {candidate.claimed_at ? ` on ${formatDate(candidate.claimed_at)}` : ""}.{" "}
            <Link
              href={`/company/profiles/${candidate.claimed_user_id}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Open their profile
            </Link>
          </p>
        )}
        {candidate.email_opted_out_at && (
          <p className="rounded-xl border p-4 text-sm">
            Unsubscribed from your emails on {formatDate(candidate.email_opted_out_at)}. Stage emails and interview
            invites aren&apos;t sent to them.
          </p>
        )}
        <CandidateMatchingJobs
          candidateId={candidate.id}
          hasEmail={!!candidate.email}
          canMatch={canMatch}
          hasOpenJobs={hasOpenJobs}
          status={matching?.ok ? matching.status : null}
          matches={
            matching?.ok
              ? matching.matches.map((m) => ({ ...m, canAdd: can(company, "applicants.import", m.jobId) }))
              : []
          }
        />
        <CandidateDetailsForm
          key={candidate.id}
          candidateId={candidate.id}
          initial={candidateFormValues(candidate)}
          canEdit={canEdit}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
