import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { UnsubscribeLine } from "./UnsubscribeLine";
import { formatInterviewDeadline } from "./screening-interview-format";

interface InterviewInviteEmailProps {
  firstName: string | null;
  companyName: string;
  jobTitle: string;
  durationMinutes: number;
  /** Names only, never the descriptions (SI-REQ-020). */
  competencyNames: string[];
  deadlineAt: string;
  /** `/interview/screening/[id]`, or an imported applicant's `/claim/[token]`, absolute. */
  interviewUrl: string;
  /**
   * BI-REQ-040/041: for someone the company imported, who has no account
   * yet. The link claims their application first.
   */
  claim?: boolean;
  /** BI-REQ-034: a company candidate's unsubscribe link. */
  unsubscribeUrl?: string | null;
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
  claim = false,
  unsubscribeUrl = null,
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

      {claim && (
        <Text className="text-sm">
          {`To take it, create a free GetHired account or log in. ${companyName} will see your account's profile for this application.`}
        </Text>
      )}

      <Section className="my-8 text-center">
        <Button
          href={interviewUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          {claim ? "Get started" : "Start the interview"}
        </Button>
      </Section>

      <Text className="text-sm text-gray-500">
        Find a quiet place and use a phone or computer with a microphone. If
        the connection drops, you can try once more. If a voice interview
        doesn&apos;t work for you, you can ask for an alternative on the
        interview page.
      </Text>
      <UnsubscribeLine companyName={companyName} url={unsubscribeUrl} />
    </BaseEmailLayout>
  );
}
