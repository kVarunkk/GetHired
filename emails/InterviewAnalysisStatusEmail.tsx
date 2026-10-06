import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { Button, Heading, Link, Section, Text } from "react-email";

export function InterviewAnalysisStatusEmail({
  candidateName,
  excerpt,
  interviewUrl,
}: {
  candidateName: string;
  excerpt: string;
  interviewUrl: string;
}) {
  return (
    <BaseEmailLayout previewText="">
      <Heading className="my-6 text-2xl font-bold text-gray-800">
        Your interview analysis is ready
      </Heading>
      <Text className="mb-6 text-base text-gray-700">
        Hi {candidateName || "there"}, your AI interview analysis is complete.
      </Text>
      <Section className="my-8 rounded-md bg-blue-50 p-4">
        <Text className="m-0 text-base text-gray-700">{excerpt}</Text>
      </Section>
      <Section className="my-8 text-center">
        <Button
          href={interviewUrl}
          className="rounded-md bg-black px-6 py-3 text-lg font-bold text-white no-underline"
        >
          View interview analysis
        </Button>
      </Section>
      <Text className="mt-6 text-sm text-gray-500">
        If the button does not work, copy this link into your browser:
        <br />
        <Link href={interviewUrl} className="break-all text-blue-600 underline">
          {interviewUrl}
        </Link>
      </Text>
      <Text className="mt-10 text-base text-gray-700">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
}
