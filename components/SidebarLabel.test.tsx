import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SidebarLabel from "./SidebarLabel";

describe("SidebarLabel", () => {
  it("stays mounted when collapsed, so the sidebar can fade it instead of jumping", () => {
    const { rerender } = render(<SidebarLabel open>Jobs</SidebarLabel>);
    expect(screen.getByText("Jobs").parentElement).toHaveClass("opacity-100");

    rerender(<SidebarLabel open={false}>Jobs</SidebarLabel>);
    expect(screen.getByText("Jobs").parentElement).toHaveClass("opacity-0");
  });

  it("truncates a long label on one line instead of wrapping or overflowing", () => {
    render(<SidebarLabel open>Join Community</SidebarLabel>);

    const text = screen.getByText("Join Community");
    expect(text).toHaveClass("truncate");
    expect(text).toHaveAttribute("title", "Join Community");
    expect(text.parentElement).toHaveClass("min-w-0");
  });

  it("keeps the trailing count visible after a long label", () => {
    render(
      <SidebarLabel open trailing={<span>3</span>}>
        A very long sidebar label that will not fit
      </SidebarLabel>,
    );

    expect(screen.getByText("3").parentElement).toHaveClass("shrink-0");
  });
});
