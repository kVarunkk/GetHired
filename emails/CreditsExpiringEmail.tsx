import * as React from "react";
import { Text } from "react-email";
import { BillingEmail, formatEmailDate } from "./BillingEmail";

export type CreditsExpiringEmailProps = {
  companyName: string;
  credits: number;
  expiresAt: string;
};

/** Sent once, 30 days before a credit lot expires (BL-REQ-004). */
export const CreditsExpiringEmail = ({ companyName, credits, expiresAt }: CreditsExpiringEmailProps) => (
  <BillingEmail
    heading={`${credits} credits expire on ${formatEmailDate(expiresAt)}`}
    ctaLabel="See your credits"
  >
    <Text className="text-base text-gray-700 mb-6">
      Hi {companyName}, {credits} of your company credits expire on {formatEmailDate(expiresAt)}. Credits are used
      oldest first, so these go before any newer ones.
    </Text>
  </BillingEmail>
);

export default CreditsExpiringEmail;
