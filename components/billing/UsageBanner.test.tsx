import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EntitlementState } from "@/helpers/billing/keys";
import UsageBanner, { type UsageBannerData } from "./UsageBanner";

const allowance = (used: number, amount: number | null): EntitlementState => ({
  kind: "allowance",
  amount,
  used,
  held: 0,
  remaining: amount === null ? null : Math.max(0, amount - used),
  overageCredits: null,
});

const data = (overrides: Partial<UsageBannerData> = {}): UsageBannerData => ({
  status: "active",
  graceUntil: null,
  entitlements: { screenings: allowance(10, 50), outreach: allowance(1, 10) },
  ...overrides,
});

describe("UsageBanner", () => {
  it("shows nothing below 80%", () => {
    const { container } = render(<UsageBanner data={data()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns at 80%", () => {
    render(<UsageBanner data={data({ entitlements: { screenings: allowance(40, 50) } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("80% of your screenings");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/company/billing");
  });

  it("is stronger at 100%", () => {
    render(<UsageBanner data={data({ entitlements: { screenings: allowance(40, 50), outreach: allowance(10, 10) } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("used all your outreach messages");
  });

  it("ignores unlimited allowances and limits", () => {
    const { container } = render(
      <UsageBanner
        data={data({
          entitlements: {
            agent_messages: allowance(9999, null),
            active_job_posts: { ...allowance(2, 2), kind: "limit" },
          },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the grace banner when past due", () => {
    render(<UsageBanner data={data({ status: "past_due", graceUntil: "2026-10-21T00:00:00Z" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("until October 21");
    expect(screen.getByRole("link", { name: "Update payment" })).toHaveAttribute("href", "/company/billing");
  });
});
