import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import CandidateApplicationsTable from "@/components/candidates/CandidateApplicationsTable";
import SectionHeader from "@/components/SectionHeader";
import { loadCandidateFrame } from "@/helpers/candidates/candidate-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications",
};

/** A candidate's applications in the company's jobs, with their stage (BI-REQ-004). */
export default async function CandidateApplicationsPage({ params }: { params: Promise<{ candidate_id: string }> }) {
  try {
    const { candidate_id } = await params;
    const frame = await loadCandidateFrame(candidate_id);
    if (!frame) notFound();

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader
          title="Applications"
          description="The jobs they're in. Nobody is emailed when you add them to one."
        />
        <CandidateApplicationsTable applications={frame.applications} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
