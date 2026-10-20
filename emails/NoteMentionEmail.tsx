import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface NoteMentionEmailProps {
  authorName: string;
  candidateFirstName: string;
  jobTitle: string | null;
  /** The note as text, already cut to 200 characters. */
  excerpt: string;
  /** The applicant or candidate page, absolute. */
  url: string;
}

/** TM-REQ-009: a teammate mentioned you in a note. */
export default function NoteMentionEmail({
  authorName,
  candidateFirstName,
  jobTitle,
  excerpt,
  url,
}: NoteMentionEmailProps) {
  const heading = `${authorName} mentioned you in a note on ${candidateFirstName}`;

  return (
    <BaseEmailLayout previewText="">
      <Text className="text-xl font-semibold">{heading}</Text>
      {jobTitle && <Text className="text-sm text-gray-500">{`For ${jobTitle}.`}</Text>}

      <Section className="rounded-md border border-solid border-gray-200 px-4">
        <Text className="text-sm">{excerpt}</Text>
      </Section>

      <Section className="my-8 text-center">
        <Button
          href={url}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Open the note
        </Button>
      </Section>

      <Text className="text-sm text-gray-500">
        You got this because you&apos;re on the hiring team. Only your team sees notes.
      </Text>
    </BaseEmailLayout>
  );
}
