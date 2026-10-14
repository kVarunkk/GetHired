import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EntitlementState } from "@/helpers/billing/keys";
import CostPreview, { costOf, type CostBreakdown } from "./CostPreview";

const state = (overrides: Partial<EntitlementState> = {}): EntitlementState => ({
  kind: "allowance",
  amount: 500,
  used: 460,
  held: 0,
  remaining: 40,
  overageCredits: 1,
  ...overrides,
});

function preview(qty: number, s: EntitlementState, creditBalance = 100) {
  let seen: CostBreakdown | null = null;
  render(
    <CostPreview entitlementKey="screenings" qty={qty} state={s} creditBalance={creditBalance}>
      {(cost) => {
        seen = cost;
        return <button disabled={!cost.canProceed}>Screen</button>;
      }}
    </CostPreview>,
  );
  return () => seen!;
}

describe("CostPreview (BL-REQ-021)", () => {
  it("12 of 40 remaining", () => {
    const cost = preview(12, state());
    expect(screen.getByText("This uses 12 of your 40 remaining screenings.")).toBeInTheDocument();
    expect(cost()).toEqual({ fromAllowance: 12, credits: 0, canProceed: true });
  });

  it("45 with 40 left and 1 credit each", () => {
    const cost = preview(45, state());
    expect(screen.getByText(/40 remaining screenings and 5 credits/)).toBeInTheDocument();
    expect(cost()).toEqual({ fromAllowance: 40, credits: 5, canProceed: true });
  });

  it("unlimited has no allowance line", () => {
    preview(1000, state({ amount: null, remaining: null }));
    expect(screen.queryByText(/remaining/)).toBeNull();
    expect(screen.getByRole("button", { name: "Screen" })).toBeEnabled();
  });

  it("a hard stop warns and blocks", () => {
    const cost = preview(45, state({ overageCredits: null }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Upgrade/);
    expect(cost().canProceed).toBe(false);
    expect(screen.getByRole("button", { name: "Screen" })).toBeDisabled();
  });

  it("not enough credits warns and blocks", () => {
    const cost = preview(45, state(), 4);
    expect(screen.getByRole("alert")).toHaveTextContent(/needs 5 credits/);
    expect(cost().canProceed).toBe(false);
  });

  it("costOf all credits when nothing is left", () => {
    expect(costOf(state({ remaining: 0, overageCredits: 2 }), 3, 10)).toEqual({
      fromAllowance: 0,
      credits: 6,
      canProceed: true,
    });
  });
});
