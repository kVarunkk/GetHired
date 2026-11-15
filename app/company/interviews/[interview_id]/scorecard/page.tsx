import { unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import KitScorecard from "@/components/interviews/kit/KitScorecard";
import SectionHeader from "@/components/SectionHeader";
import { requireOpenKit } from "@/helpers/interviews/kit-page";

export const metadata: Metadata = {
  title: "Scorecard",
};

/** The session member's own scorecard for the interview (IVT-018). */
export default async function InterviewKitScorecardPage({ params }: { params: Promise<{ interview_id: string }> }) {
  try {
    const { interview_id } = await params;
    const { kit } = await requireOpenKit(interview_id);
    return (
      <>
        <SectionHeader title="Your scorecard" />
        <KitScorecard kit={kit} />
      </>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
