import { unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import ApplicationAnswers from "@/components/applications/ApplicationAnswers";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { answersView } from "@/helpers/applications/answers-view";
import { requireOpenKit } from "@/helpers/interviews/kit-page";

export const metadata: Metadata = {
  title: "Application",
};

/** The candidate's answers to the job's application form. */
export default async function InterviewKitApplicationPage({ params }: { params: Promise<{ interview_id: string }> }) {
  try {
    const { interview_id } = await params;
    const { kit } = await requireOpenKit(interview_id);
    const answers = answersView(
      {
        answers: kit.application.answers as string[] | null,
        answers_v2: kit.application.answersV2,
        form_snapshot: kit.application.formSnapshot,
      },
      kit.job.questions,
    );
    return (
      <>
        <SectionHeader title="Application" description={`What ${kit.candidate.name} answered when applying.`} />
        <ApplicationAnswers answers={answers} />
      </>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
