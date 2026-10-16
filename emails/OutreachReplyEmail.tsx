import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

export const DECLINE_REASON_LABELS: Record<string, string> = {
  not_looking: "Not looking right now",
  role_mismatch: "The role isn't a fit",
  location: "Location",
  compensation: "Compensation",
  company: "The company",
  other: "Other",
};

interface OutreachReplyEmailProps {
  candidateFirstName: string;
  status: "interested" | "not_interested";
  subject: string;
  jobTitle: string | null;
  /** Shown only for `interested`. */
  note: string | null;
  /** Shown only for `interested`. */
  contact: string | null;
  declineReason: string | null;
  profileUrl: string;
}

/** The candidate's answer, to the member who sent the outreach (OR-REQ-004). */
export default function OutreachReplyEmail({
  candidateFirstName,
  status,
  subject,
  jobTitle,
  note,
  contact,
  declineReason,
  profileUrl,
}: OutreachReplyEmailProps) {
  const interested = status === "interested";
  const heading = interested
    ? `${candidateFirstName} is interested`
    : `${candidateFirstName} isn't interested right now`;

  return (
    <BaseEmailLayout previewText={heading}>
      <Text className="text-xl font-semibold">{heading}</Text>
      <Text className="text-sm text-gray-500">
        {`In reply to "${subject}"${jobTitle ? ` about ${jobTitle}` : ""}.`}
      </Text>

      {interested && (note || contact) && (
        <Section className="rounded-md border border-solid border-gray-200 px-4">
          {note && <Text className="text-sm">{note}</Text>}
          {contact && <Text className="text-sm">{`Preferred contact: ${contact}`}</Text>}
        </Section>
      )}
      {!interested && declineReason && DECLINE_REASON_LABELS[declineReason] && (
        <Text className="text-sm">{`Reason: ${DECLINE_REASON_LABELS[declineReason]}`}</Text>
      )}

      <Text className="text-sm">
        {interested
          ? `${candidateFirstName}'s contact details and resume are now on their profile.`
          : "You can't see their contact details."}
      </Text>

      <Section className="my-8 text-center">
        <Button href={profileUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Open profile
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
