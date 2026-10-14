import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CompanyPlanLink from "./CompanyPlanLink";

describe("CompanyPlanLink", () => {
  it("shows the plan and credits and links to billing", () => {
    render(<CompanyPlanLink plan={{ name: "Startup", slug: "startup", credits: 1240 }} />);

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("Plan: Startup · 1,240 credits");
    expect(link).toHaveAttribute("href", "/company/billing");
  });

  it("falls back when the plan couldn't be loaded", () => {
    render(<CompanyPlanLink plan={null} />);
    expect(screen.getByRole("link")).toHaveTextContent("Plan and billing");
  });
});
