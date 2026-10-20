import { describe, expect, it } from "vitest";
import { TAICredits } from "@/utils/types";
import { ALLOWANCE_KEYS } from "@/helpers/billing/keys";
import { APPLICANT_CREDIT_COSTS, companyCreditCosts } from "./credit-costs";

describe("credit costs", () => {
  it("prices applicant features from the same numbers the server charges", () => {
    const cost = (feature: string) =>
      APPLICANT_CREDIT_COSTS.find((c) => c.feature === feature)?.cost;

    expect(cost("Apply to a job on GetHired")).toBe(
      `${TAICredits.JOB_APPLICATION} credit per application`,
    );
    expect(cost("AI job summary")).toBe(`${TAICredits.AI_SUMMARY} credits`);
    expect(cost("AI mock interview")).toBe(
      `${TAICredits.AI_INTERVIEW} credits per session`,
    );
  });

  it("lists every company allowance with its credit price beyond the plan", () => {
    const costs = companyCreditCosts({
      screenings: 1,
      match_explanations: 2,
      agent_messages: null,
    });

    expect(costs).toHaveLength(ALLOWANCE_KEYS.length);
    expect(
      costs.find((c) => c.feature === "AI applicant screening")?.cost,
    ).toBe("1 credit per screening beyond your plan");
    expect(costs.find((c) => c.feature === "Match explanations")?.cost).toBe(
      "2 credits per explanation beyond your plan",
    );
    // No overage price: the allowance is a hard stop.
    expect(costs.find((c) => c.feature === "Hiring assistant")?.cost).toBe(
      "Included in your plan only",
    );
  });
});
