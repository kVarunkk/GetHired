import * as React from "react";
import { Text } from "react-email";
import { BillingEmail, formatEmailDate } from "./BillingEmail";

export type PaymentFailedEmailProps = {
  companyName: string;
  planName: string;
  graceUntil: string;
};

/** BL-REQ-013: sent on days 0, 3 and 6 of the grace period. */
export const PaymentFailedEmail = ({ companyName, planName, graceUntil }: PaymentFailedEmailProps) => (
  <BillingEmail
    previewText={`We couldn't renew ${companyName}'s ${planName} plan`}
    heading={`We couldn't take payment for your ${planName} plan`}
    ctaLabel="Update payment method"
  >
    <Text className="text-base text-gray-700 mb-6">
      Hi {companyName}, your last payment for {planName} didn&apos;t go through. Everything keeps working until{" "}
      {formatEmailDate(graceUntil)}.
    </Text>
    <Text className="text-base text-gray-700 mb-6">
      Please update your payment method before then. If we still can&apos;t take payment, your company moves to the
      Free plan. Nothing is deleted.
    </Text>
  </BillingEmail>
);

export default PaymentFailedEmail;
