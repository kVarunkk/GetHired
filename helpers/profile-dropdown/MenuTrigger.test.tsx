import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import MenuTrigger from "./MenuTrigger";

const user = { id: "u1", user_metadata: {} } as unknown as User;

const renderTrigger = (props: { isVertical?: boolean; isMenuOpen: boolean; roleLabel?: string }) =>
  render(
    <DropdownMenu>
      <MenuTrigger user={user} open={false} isCompanyUser={false} {...props} />
    </DropdownMenu>,
  );

describe("MenuTrigger", () => {
  it("is a compact icon button in the horizontal navbar, with no hidden label taking space", () => {
    renderTrigger({ isMenuOpen: false });

    const trigger = screen.getByRole("button", { name: "Profile" });
    expect(trigger).toHaveClass("h-9", "w-9");
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("keeps a fading label in the vertical sidebar", () => {
    renderTrigger({ isVertical: true, isMenuOpen: false });

    expect(screen.getByText("Profile")).toHaveClass("opacity-0");
  });

  it("shows a company member's role next to the label in the vertical sidebar", () => {
    renderTrigger({ isVertical: true, isMenuOpen: true, roleLabel: "Admin" });

    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows no role in the compact navbar button", () => {
    renderTrigger({ isMenuOpen: false, roleLabel: "Admin" });

    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
