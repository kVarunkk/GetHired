import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthButton } from "./auth-button";

const renderButtons = (variant: "horizontal" | "vertical", isMenuOpen = true) =>
  render(
    <TooltipProvider>
      <AuthButton isMenuOpen={isMenuOpen} variant={variant} />
    </TooltipProvider>,
  );

describe("AuthButton", () => {
  // jsdom has no matchMedia results, like the first render before effects:
  // the layout must be right without measuring the screen.
  it("stacks the buttons with icons in the vertical sidebar from the first render", () => {
    const { container } = renderButtons("vertical");

    expect(container.firstChild).toHaveClass("flex-col");
    expect(screen.getByRole("link", { name: "Sign in" }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign up" }).querySelector("svg")).not.toBeNull();
  });

  it("puts the buttons in a row in the horizontal bar", () => {
    const { container } = renderButtons("horizontal");

    expect(container.firstChild).not.toHaveClass("flex-col");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/auth/sign-up");
  });
});
