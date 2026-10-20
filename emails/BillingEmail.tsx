import * as React from "react";
import { Button, Heading, Link, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

export const BILLING_URL = "https://gethired.devhub.co.in/company/billing";

/** The shared frame of the company billing emails (BL-TASK-023). */
export function BillingEmail({
  heading,
  children,
  ctaLabel,
  ctaHref = BILLING_URL,
}: {
  heading: string;
  children: React.ReactNode;
  ctaLabel: string;
  ctaHref?: string;
}) {
  return (
    <BaseEmailLayout previewText="">
      <Heading className="text-2xl font-bold text-gray-800 my-6">{heading}</Heading>
      {children}
      <Section className="my-8">
        <Button
          href={ctaHref}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          {ctaLabel}
        </Button>
      </Section>
      <Text className="text-sm text-gray-500 mt-6">
        If the button doesn&apos;t work, open this link:
        <br />
        <Link href={ctaHref} className="text-blue-600 underline break-all">
          {ctaHref}
        </Link>
      </Text>
      <Text className="text-base text-gray-700 mt-10">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
}

export const formatEmailDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
