import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface CompanyInviteEmailProps {
  companyName: string;
  inviterName: string;
  /** The company's own name for the role (RP-GUD-002). */
  roleName: string;
  /** `/company/join?token=…`, absolute. */
  joinUrl: string;
}

/** TM-REQ-002: an invite to join a company's team. Nothing else about the company. */
export default function CompanyInviteEmail({
  companyName,
  inviterName,
  roleName,
  joinUrl,
}: CompanyInviteEmailProps) {
  const heading = `Join ${companyName} on GetHired`;

  return (
    <BaseEmailLayout previewText={``}>
      <Text className="text-xl font-semibold">{heading}</Text>
      <Text className="text-sm">
        {`${inviterName} invited you to join ${companyName}'s hiring team on GetHired with the ${roleName} role.`}
      </Text>

      <Section className="my-8 text-center">
        <Button
          href={joinUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Accept invite
        </Button>
      </Section>

      <Text className="text-sm text-gray-500">
        This link expires in 7 days and works once. If you weren&apos;t
        expecting it, you can ignore this email.
      </Text>
    </BaseEmailLayout>
  );
}
