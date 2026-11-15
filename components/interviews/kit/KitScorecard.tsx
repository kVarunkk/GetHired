import ScorecardForm from "@/components/interviews/kit/ScorecardForm";
import type { InterviewKit } from "@/helpers/interviews/scorecards";

/** The session member's scorecard on an interview kit page. */
export default function KitScorecard({ kit }: { kit: InterviewKit }) {
  const started = !!kit.interview.startsAt && Date.parse(kit.interview.startsAt) <= Date.now();
  return (
    <ScorecardForm
      interviewId={kit.interview.id}
      interviewStatus={kit.interview.status}
      started={started}
      competencies={kit.interview.competencies}
      initial={kit.scorecard}
    />
  );
}
