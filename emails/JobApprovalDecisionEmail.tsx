import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface JobApprovalDecisionEmailProps {
  jobTitle: string;
  decision: "approved" | "changes_requested";
  /** Who reviewed it, by their name in the company; null when unknown. */
  reviewerName: string | null;
  /** The reviewer's note: required when changes were requested. */
  note: string | null;
  /** The job's page in the company app, absolute. */
  jobUrl: string;
}

/** To the submitter, when their job was approved or sent back (JL-REQ-021). */
export default function JobApprovalDecisionEmail({
  jobTitle,
  decision,
  reviewerName,
  note,
  jobUrl,
}: JobApprovalDecisionEmailProps) {
  const who = reviewerName ?? "An approver";
  const approved = decision === "approved";
  return (
    <BaseEmailLayout previewText={approved ? `${jobTitle} was approved` : `Changes requested on ${jobTitle}`}>
      <Text className="text-xl font-semibold">
        {approved ? `${jobTitle} is approved and open` : `Changes requested on ${jobTitle}`}
      </Text>
      <Text className="text-sm">
        {approved
          ? `${who} approved ${jobTitle}. It's open to applicants now.`
          : `${who} sent ${jobTitle} back to a draft. Make the changes, then submit it again.`}
      </Text>
      {note && <Text className="whitespace-pre-wrap rounded-md border border-solid border-gray-200 p-3 text-sm">{note}</Text>}

      <Section className="my-8 text-center">
        <Button href={jobUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Open the job
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
