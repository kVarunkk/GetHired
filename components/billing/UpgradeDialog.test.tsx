import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import posthog from "@/lib/posthog/client";
import type { EntitlementPayload } from "@/helpers/billing/errors";
import UpgradeDialog from "./UpgradeDialog";

vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));

const SCREENINGS: EntitlementPayload = {
  key: "screenings",
  kind: "allowance",
  qty: 1,
  used: 50,
  amount: 50,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 0,
  reason: "limit_reached",
  suggestedTier: { slug: "startup", name: "Startup" },
};

function open(payload: EntitlementPayload, onUseCredits?: () => void) {
  render(<UpgradeDialog payload={payload} open onOpenChange={() => {}} onUseCredits={onUseCredits} />);
}

beforeEach(() => vi.clearAllMocks());

describe("UpgradeDialog (BL-TEST-005)", () => {
  it("says what ran out", () => {
    open(SCREENINGS);
    expect(screen.getByText(/You've used 50 of 50 screenings this month/)).toBeInTheDocument();
  });

  it("links the upgrade to the suggested plan", () => {
    open(SCREENINGS);
    expect(screen.getByRole("link", { name: /Upgrade to Startup/ })).toHaveAttribute(
      "href",
      "/company/billing?plan=startup",
    );
  });

  it("offers credits only when overage is allowed and the balance covers it", () => {
    const onUseCredits = vi.fn();
    open({ ...SCREENINGS, overageCredits: 1, creditBalance: 5, creditsNeeded: 3 }, onUseCredits);

    fireEvent.click(screen.getByRole("button", { name: /Use 3 credits/ }));
    expect(onUseCredits).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Buy credits" })).toHaveAttribute("href", "/company/billing#credits");
  });

  it("doesn't offer credits the company doesn't have", () => {
    open({ ...SCREENINGS, overageCredits: 1, creditBalance: 2, creditsNeeded: 3 }, vi.fn());
    expect(screen.queryByRole("button", { name: /Use .* credits/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Buy credits" })).toBeInTheDocument();
  });

  it("doesn't offer credits on a hard stop", () => {
    open({ ...SCREENINGS, creditBalance: 100, creditsNeeded: 1 }, vi.fn());
    expect(screen.queryByRole("button", { name: /Use .* credits/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Buy credits" })).toBeNull();
  });

  it("never offers credits for a limit", () => {
    open(
      { ...SCREENINGS, key: "active_job_posts", kind: "limit", used: 2, amount: 2, overageCredits: 1, creditBalance: 100, creditsNeeded: 1 },
      vi.fn(),
    );
    expect(screen.getByText(/using 2 of 2 active job posts/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use .* credits/ })).toBeNull();
  });

  it("hides the upgrade when nothing above fits", () => {
    open({ ...SCREENINGS, suggestedTier: null });
    expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
  });

  it("captures billing_upgrade_dialog_shown", () => {
    open(SCREENINGS);
    expect(posthog.capture).toHaveBeenCalledWith("billing_upgrade_dialog_shown", {
      key: "screenings",
      kind: "allowance",
      suggestedTier: "startup",
    });
  });
});
