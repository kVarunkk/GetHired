import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

export interface InterviewFeedbackEmailProps {
  interviewName: string;
  jobTitle: string;
  /** The candidate's first name, or "the candidate". */
  candidateFirstName: string;
  /** The interview kit, absolute. */
  kitUrl: string;
}

/** IV-REQ-040: sent once to each interviewer without a submitted scorecard, when the interview is over. */
export default function InterviewFeedbackRequest({
  interviewName,
  jobTitle,
  candidateFirstName,
  kitUrl,
}: InterviewFeedbackEmailProps) {
  return (
    <BaseEmailLayout previewText={`Your scorecard for ${candidateFirstName} is waiting.`}>
      <Text className="text-xl font-semibold">{`How did ${interviewName} with ${candidateFirstName} go?`}</Text>
      <Text className="text-sm">
        {`The interview for ${jobTitle} is over. Fill in your scorecard while it's fresh. Your teammates' feedback stays hidden until you submit yours.`}
      </Text>
      <Section className="my-8 text-center">
        <Button href={kitUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Write your scorecard
        </Button>
      </Section>
      <Text className="text-sm text-gray-500">
        You got this because you were on the interview panel. We&apos;ll send one reminder if it&apos;s still open
        tomorrow.
      </Text>
    </BaseEmailLayout>
  );
}
