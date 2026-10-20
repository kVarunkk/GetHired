import { describe, expect, it } from "vitest";
import { render } from "react-email";
import { UsageThresholdEmail } from "./UsageThresholdEmail";
import { PaymentFailedEmail } from "./PaymentFailedEmail";
import { PlanChangedEmail } from "./PlanChangedEmail";
import { CreditsExpiringEmail } from "./CreditsExpiringEmail";
import { BILLING_URL } from "./BillingEmail";

async function both(el: React.ReactElement) {
  return { html: await render(el), text: await render(el, { plainText: true }) };
}

describe("billing emails (BLT-094)", () => {
  it("UsageThresholdEmail has the numbers and the billing link", async () => {
    const { html, text } = await both(
      <UsageThresholdEmail
        companyName="Acme"
        label="screenings"
        used={40}
        amount={50}
        threshold={80}
        resetsAt="2026-11-01T00:00:00Z"
        canUseCredits={false}
      />,
    );
    for (const out of [html, text]) {
      expect(out).toContain("40 of 50 screenings");
      expect(out).toContain(BILLING_URL);
    }
    expect(text).toMatch(/80% of your screenings/i);
  });

  it("UsageThresholdEmail at 100% mentions credits when overage is allowed", async () => {
    const { text } = await both(
      <UsageThresholdEmail companyName="Acme" label="outreach messages" used={150} amount={150} threshold={100} resetsAt="2026-11-01T00:00:00Z" canUseCredits />,
    );
    expect(text).toMatch(/used all your outreach messages/i);
    expect(text).toContain("company credits");
  });

  it("PaymentFailedEmail has the grace end and the billing link", async () => {
    const { html, text } = await both(
      <PaymentFailedEmail companyName="Acme" planName="Startup" graceUntil="2026-10-21T00:00:00Z" />,
    );
    for (const out of [html, text]) {
      expect(out).toContain("October 21, 2026");
      expect(out).toContain(BILLING_URL);
    }
  });

  it("PlanChangedEmail explains a scheduled downgrade", async () => {
    const { text } = await both(
      <PlanChangedEmail companyName="Acme" fromPlan="Growth" toPlan="Startup" effectiveAt="2026-11-01T00:00:00Z" scheduled />,
    );
    expect(text).toMatch(/changes to Startup on November 1, 2026/i);
    expect(text).toContain(BILLING_URL);
  });

  it("CreditsExpiringEmail has the amount and the date", async () => {
    const { html, text } = await both(
      <CreditsExpiringEmail companyName="Acme" credits={120} expiresAt="2026-11-13T00:00:00Z" />,
    );
    for (const out of [html, text]) {
      expect(out).toContain("120");
      expect(out).toContain("November 13, 2026");
      expect(out).toContain(BILLING_URL);
    }
  });
});
