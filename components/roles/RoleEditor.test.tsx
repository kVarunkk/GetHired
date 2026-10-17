import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { createRoleAction } from "@/app/actions/roles/create-role";
import RoleEditor from "./RoleEditor";

vi.mock("@/app/actions/roles/create-role", () => ({ createRoleAction: vi.fn() }));
vi.mock("@/app/actions/roles/update-role", () => ({ updateRoleAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

// Radix's checkbox measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeEach(() => vi.clearAllMocks());

describe("RoleEditor", () => {
  it("shows a refused save next to the Save button and stays on the page", async () => {
    vi.mocked(createRoleAction).mockResolvedValue({ ok: false, error: "Another role already has that name." });
    render(
      <RoleEditor
        mode="create"
        initial={{ name: "Recruiter", description: "", color: "slate", grants: [], limits: {} }}
        viewer={{ isOwner: true, grants: [], limits: {} }}
      />,
    );

    const save = screen.getByRole("button", { name: "Save role" });
    fireEvent.click(save);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Another role already has that name.");
    // In the sticky save bar, so it's on screen wherever Save was clicked.
    expect(within(save.parentElement!).getByRole("alert")).toBe(alert);
    expect(toast.success).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
