import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface JobClosingSoonEmailProps {
  jobTitle: string;
  /** The closing date as the company reads it, e.g. "December 31, 2026". */
  closesOn: string;
  /** The job's edit page in the company app, absolute. */
  editUrl: string;
}

/** To the job's hiring team, a few days before its closing date (JL-REQ-017). */
export default function JobClosingSoonEmail({ jobTitle, closesOn, editUrl }: JobClosingSoonEmailProps) {
  return (
    <BaseEmailLayout previewText={`${jobTitle} closes on ${closesOn}`}>
      <Text className="text-xl font-semibold">{`${jobTitle} closes on ${closesOn}`}</Text>
      <Text className="text-sm">
        {`${jobTitle} stops taking applications at the end of ${closesOn}. If you need more time, move the closing date forward or clear it.`}
      </Text>

      <Section className="my-8 text-center">
        <Button href={editUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Change the closing date
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
