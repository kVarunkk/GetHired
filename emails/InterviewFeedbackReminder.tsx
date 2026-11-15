import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";
import type { InterviewFeedbackEmailProps } from "./InterviewFeedbackRequest";

/**
 * IV-REQ-040: the one automatic reminder, 24 h after the request, while the
 * scorecard is still open. With `requestedBy`, it's a teammate's "Remind"
 * (IVT-084), which can come again, so it doesn't say it's the last one.
 */
export default function InterviewFeedbackReminder({
  interviewName,
  jobTitle,
  candidateFirstName,
  kitUrl,
  requestedBy,
}: InterviewFeedbackEmailProps & { requestedBy?: string }) {
  return (
    <BaseEmailLayout previewText={`Your team is waiting on your feedback for ${candidateFirstName}.`}>
      <Text className="text-xl font-semibold">{`Your scorecard for ${candidateFirstName} is still open`}</Text>
      <Text className="text-sm">
        {requestedBy
          ? `${requestedBy} asked for your feedback from ${interviewName} (${jobTitle}), to decide on next steps.`
          : `Your team is waiting on your feedback from ${interviewName} (${jobTitle}) to decide on next steps.`}
      </Text>
      <Section className="my-8 text-center">
        <Button href={kitUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Write your scorecard
        </Button>
      </Section>
      {!requestedBy && <Text className="text-sm text-gray-500">This is the last reminder for this interview.</Text>}
    </BaseEmailLayout>
  );
}
