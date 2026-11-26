import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface JobApprovalRequestEmailProps {
  jobTitle: string;
  /** Who submitted it, by their name in the company; null when unknown. */
  submitterName: string | null;
  /** The job's page in the company app, absolute. */
  jobUrl: string;
}

/** To the job's approvers, when a job is submitted for approval (JL-REQ-021). */
export default function JobApprovalRequestEmail({ jobTitle, submitterName, jobUrl }: JobApprovalRequestEmailProps) {
  const who = submitterName ?? "A teammate";
  return (
    <BaseEmailLayout previewText={`${jobTitle} is waiting for your approval`}>
      <Text className="text-xl font-semibold">{`${jobTitle} is waiting for approval`}</Text>
      <Text className="text-sm">
        {`${who} submitted ${jobTitle} for approval. It opens to applicants once it's approved. You can approve it, or send it back with a note saying what to change.`}
      </Text>

      <Section className="my-8 text-center">
        <Button href={jobUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Review the job
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
