import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface JobAutoClosedEmailProps {
  jobTitle: string;
  /** The closing date as the company reads it, e.g. "December 31, 2026". */
  closedOn: string;
  /** The job's page in the company app, absolute. */
  jobUrl: string;
}

/** To the job's hiring team, when its closing date passed (JL-REQ-015). */
export default function JobAutoClosedEmail({ jobTitle, closedOn, jobUrl }: JobAutoClosedEmailProps) {
  return (
    <BaseEmailLayout previewText={`${jobTitle} closed on its closing date`}>
      <Text className="text-xl font-semibold">{`${jobTitle} is closed`}</Text>
      <Text className="text-sm">
        {`${jobTitle} reached its closing date, ${closedOn}, and closed itself. It no longer takes applications and is off the job board, your careers page and the job sites.`}
      </Text>
      <Text className="text-sm">
        Candidates who already applied are still in the pipeline. To take applications again, move the closing
        date forward or clear it, then reopen the job.
      </Text>

      <Section className="my-8 text-center">
        <Button href={jobUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Open the job
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
