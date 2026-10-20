import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { formatInterviewDeadline } from "./screening-interview-format";

interface InterviewInviteEmailProps {
  firstName: string | null;
  companyName: string;
  jobTitle: string;
  durationMinutes: number;
  /** Names only, never the descriptions (SI-REQ-020). */
  competencyNames: string[];
  deadlineAt: string;
  /** `/interview/screening/[id]`, absolute. */
  interviewUrl: string;
}

/** SI-REQ-013: the invite to a company's AI screening interview. */
export default function InterviewInviteEmail({
  firstName,
  companyName,
  jobTitle,
  durationMinutes,
  competencyNames,
  deadlineAt,
  interviewUrl,
}: InterviewInviteEmailProps) {
  return (
    <BaseEmailLayout previewText="" company={{ name: companyName }}>
      <Text className="text-xl font-semibold">{`Your AI interview for ${jobTitle}`}</Text>
      <Text className="text-sm">{firstName ? `Hi ${firstName},` : "Hi,"}</Text>
      <Text className="text-sm">
        {`Thanks for applying to ${jobTitle} at ${companyName}. The next step is a ${durationMinutes}-minute interview with an AI interviewer, by voice, whenever suits you before ${formatInterviewDeadline(deadlineAt)}.`}
      </Text>
      <Text className="text-sm">{`It covers: ${competencyNames.join(", ")}.`}</Text>
      <Text className="text-sm">
        {`The conversation is transcribed and shared with ${companyName}. ${companyName} makes the decision, not the AI. Audio isn't stored.`}
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
        Find a quiet place and use a phone or computer with a microphone. If
        the connection drops, you can try once more. If a voice interview
        doesn&apos;t work for you, you can ask for an alternative on the
        interview page.
      </Text>
    </BaseEmailLayout>
  );
}
