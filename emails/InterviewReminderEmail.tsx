import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { UnsubscribeLine } from "./UnsubscribeLine";
import { formatInterviewDeadline } from "./screening-interview-format";

interface InterviewReminderEmailProps {
  companyName: string;
  jobTitle: string;
  durationMinutes: number;
  deadlineAt: string;
  /** `/interview/screening/[id]`, or an imported applicant's `/claim/[token]` (BI-REQ-041). */
  interviewUrl: string;
  /** BI-REQ-034: a company candidate's unsubscribe link. */
  unsubscribeUrl?: string | null;
}

/** SI-REQ-014: sent once, 48 hours before the deadline, if not started. */
export default function InterviewReminderEmail({
  companyName,
  jobTitle,
  durationMinutes,
  deadlineAt,
  interviewUrl,
  unsubscribeUrl = null,
}: InterviewReminderEmailProps) {
  return (
    <BaseEmailLayout previewText="" company={{ name: companyName }}>
      <Text className="text-xl font-semibold">{`Your AI interview for ${jobTitle} is due soon`}</Text>
      <Text className="text-sm">
        {`${companyName} is waiting for your interview. It takes about ${durationMinutes} minutes, and the deadline is ${formatInterviewDeadline(deadlineAt)}.`}
      </Text>

      <Section className="my-8 text-center">
        <Button
          href={interviewUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Start the interview
        </Button>
      </Section>

      <Text className="text-sm text-gray-500">
        Can&apos;t do a voice interview? Ask for an alternative on the interview page.
      </Text>
      <UnsubscribeLine companyName={companyName} url={unsubscribeUrl} />
    </BaseEmailLayout>
  );
}
