import * as React from "react";
import { Text } from "react-email";
import { BillingEmail, formatEmailDate } from "./BillingEmail";

export type UsageThresholdEmailProps = {
  companyName: string;
  /** Plural, e.g. "screenings". */
  label: string;
  used: number;
  amount: number;
  threshold: 80 | 100;
  /** When the allowance resets. */
  resetsAt: string;
  canUseCredits: boolean;
};

/** BL-REQ-022: 80% and 100% of a monthly allowance. */
export const UsageThresholdEmail = ({
  companyName,
  label,
  used,
  amount,
  threshold,
  resetsAt,
  canUseCredits,
}: UsageThresholdEmailProps) => {
  const full = threshold >= 100;
  return (
    <BillingEmail
      heading={full ? `You've used all your ${label} this month` : `You've used ${threshold}% of your ${label}`}
      ctaLabel={full ? "Upgrade or buy credits" : "See your usage"}
    >
      <Text className="text-base text-gray-700 mb-6">
        Hi {companyName}, you&apos;ve used {used} of {amount} {label} on your plan this month. They reset on{" "}
        {formatEmailDate(resetsAt)}.
      </Text>
      <Text className="text-base text-gray-700 mb-6">
        {full
          ? canUseCredits
            ? "Further use is paid with company credits. Upgrade for a bigger monthly allowance."
            : "To keep going before then, upgrade your plan."
          : "Upgrade before you run out to keep everything running."}
      </Text>
    </BillingEmail>
  );
};

export default UsageThresholdEmail;
