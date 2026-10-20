import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PUBLIC_TIERS, type TierFixture } from "@/test/utils/billing";
import type { Plan } from "@/helpers/billing/plans";
import PlanCards from "./PlanCards";

const PRICES: Record<string, Plan["prices"]> = {
  startup: [
    { interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: "pdt_s_m" },
    { interval: "year", currency: "USD", amount_minor: 49000, dodo_product_id: "pdt_s_y" },
    { interval: "month", currency: "INR", amount_minor: 299900, dodo_product_id: "pdt_s_m_inr" },
  ],
  growth: [
    { interval: "month", currency: "USD", amount_minor: 14900, dodo_product_id: "pdt_g_m" },
    { interval: "year", currency: "USD", amount_minor: 149000, dodo_product_id: "pdt_g_y" },
  ],
};

const asPlan = (t: TierFixture): Plan => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  description: null,
  features: [],
  sort: t.sort,
  prices: PRICES[t.slug] ?? [],
  entitlements: Object.fromEntries(
    t.entitlements.map((e) => [e.key, { kind: e.kind, amount: e.amount, overageCredits: e.overage_credits }]),
  ),
});
const PLANS = PUBLIC_TIERS.map(asPlan);
const card = (name: string) => screen.getByRole("listitem", { name });

describe("PlanCards", () => {
  it("renders public plans in order", () => {
    render(<PlanCards plans={PLANS} />);
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Free", "Startup", "Growth", "Enterprise"]);
  });

  it("switches prices between monthly and annual, and currencies", () => {
    render(<PlanCards plans={PLANS} />);
    expect(within(card("Startup")).getByText("$49")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    expect(within(card("Startup")).getByText("$490")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.click(screen.getByRole("button", { name: "INR" }));
    expect(within(card("Startup")).getByText("₹2,999")).toBeInTheDocument();
  });

  it("shows ∞ for unlimited", () => {
    render(<PlanCards plans={PLANS} />);
    expect(within(card("Startup")).getByText("∞ candidates per search")).toBeInTheDocument();
    expect(within(card("Free")).getByText("20 candidates per search")).toBeInTheDocument();
  });

  it("marks the current plan and disables its button", () => {
    render(<PlanCards plans={PLANS} currentSlug="startup" onSelect={vi.fn()} />);
    expect(within(card("Startup")).getByRole("button", { name: "Current plan" })).toBeDisabled();
  });

  it("calls onSelect with the plan, interval and currency", () => {
    const onSelect = vi.fn();
    render(<PlanCards plans={PLANS} currentSlug="free" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    fireEvent.click(within(card("Growth")).getByRole("button", { name: "Choose Growth" }));

    expect(onSelect).toHaveBeenCalledWith("growth", "year", "USD");
  });

  it("links to company signup on the public page", () => {
    render(<PlanCards plans={PLANS} />);
    expect(within(card("Startup")).getByRole("link", { name: "Start with Startup" })).toHaveAttribute(
      "href",
      "/auth/sign-up?company=true",
    );
    expect(within(card("Enterprise")).getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
  });
});
