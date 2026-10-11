import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SidebarLabel from "./SidebarLabel";

describe("SidebarLabel", () => {
  it("stays mounted when collapsed, so the sidebar can fade it instead of jumping", () => {
    const { rerender } = render(<SidebarLabel open>Jobs</SidebarLabel>);
    expect(screen.getByText("Jobs")).toHaveClass("opacity-100");

    rerender(<SidebarLabel open={false}>Jobs</SidebarLabel>);
    expect(screen.getByText("Jobs")).toHaveClass("opacity-0");
  });

  it("never wraps while the sidebar width animates", () => {
    render(<SidebarLabel open>Join Community</SidebarLabel>);

    expect(screen.getByText("Join Community")).toHaveClass("whitespace-nowrap");
  });
});
