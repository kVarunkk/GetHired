import * as React from "react";
import { Text } from "react-email";
import { BillingEmail, formatEmailDate } from "./BillingEmail";

export type PlanChangedEmailProps = {
  companyName: string;
  fromPlan: string;
  toPlan: string;
  /** When the change applies: now for upgrades, the period end for downgrades. */
  effectiveAt: string;
  scheduled: boolean;
};

export const PlanChangedEmail = ({ companyName, fromPlan, toPlan, effectiveAt, scheduled }: PlanChangedEmailProps) => (
  <BillingEmail
    heading={scheduled ? `Your plan changes to ${toPlan} on ${formatEmailDate(effectiveAt)}` : `You're now on ${toPlan}`}
    ctaLabel="See your plan"
  >
    <Text className="text-base text-gray-700 mb-6">
      Hi {companyName},{" "}
      {scheduled
        ? `you'll stay on ${fromPlan} until ${formatEmailDate(effectiveAt)}, then move to ${toPlan}. Nothing is deleted; anything over the new plan's limits stays as it is but can't grow.`
        : `your plan changed from ${fromPlan} to ${toPlan}. The new limits and allowances apply now.`}
    </Text>
  </BillingEmail>
);

export default PlanChangedEmail;
