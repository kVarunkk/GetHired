import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface InterviewCompletedCompanyEmailProps {
  candidateName: string;
  jobTitle: string;
  /** The applicant page's AI interview tab, absolute. */
  reportUrl: string;
  /** False when the interview was too short to score. */
  scored: boolean;
}

/** To members with interviews.view on the job, once the report is ready. */
export default function InterviewCompletedCompanyEmail({
  candidateName,
  jobTitle,
  reportUrl,
  scored,
}: InterviewCompletedCompanyEmailProps) {
  return (
    <BaseEmailLayout previewText={`${candidateName} finished the AI interview for ${jobTitle}`}>
      <Text className="text-xl font-semibold">{`${candidateName} finished the AI interview`}</Text>
      <Text className="text-sm">
        {scored
          ? `${candidateName} finished the AI interview for ${jobTitle}. The report is ready, with quotes from the transcript for each competency.`
          : `${candidateName} finished the AI interview for ${jobTitle}, but it was too short to score. The transcript is on their application.`}
      </Text>

      <Section className="my-8 text-center">
        <Button
          href={reportUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          {scored ? "Read the report" : "Open the application"}
        </Button>
      </Section>

      <Text className="text-sm text-gray-500">
        The report is AI-generated and is a screening signal only. Check the
        transcript before you decide.
      </Text>
    </BaseEmailLayout>
  );
}
