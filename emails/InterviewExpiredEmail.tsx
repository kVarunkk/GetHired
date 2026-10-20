import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

type InterviewExpiredEmailProps =
  | { audience: "candidate"; companyName: string; jobTitle: string }
  | {
      audience: "company";
      companyName: string;
      jobTitle: string;
      candidateName: string;
      applicantUrl: string;
    };

/** SI-REQ-014: an invite still open at its deadline. Both sides are told. */
export default function InterviewExpiredEmail(props: InterviewExpiredEmailProps) {
  const { companyName, jobTitle } = props;

  if (props.audience === "candidate") {
    return (
      <BaseEmailLayout previewText={`Your AI interview for ${jobTitle} expired`}>
        <Text className="text-xl font-semibold">Your interview invite expired</Text>
        <Text className="text-sm">
          {`Your AI interview for ${jobTitle} at ${companyName} has expired. Your application is still with ${companyName}; they decide what happens next.`}
        </Text>
      </BaseEmailLayout>
    );
  }

  return (
    <BaseEmailLayout previewText={`${props.candidateName}'s AI interview invite expired`}>
      <Text className="text-xl font-semibold">An interview invite expired</Text>
      <Text className="text-sm">
        {`${props.candidateName} didn't take the AI interview for ${jobTitle} before the deadline. You can extend it from their application.`}
      </Text>
      <Section className="my-8 text-center">
        <Button
          href={props.applicantUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Open the application
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
