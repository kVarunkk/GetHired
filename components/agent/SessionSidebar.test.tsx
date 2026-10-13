import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionSidebar from "./SessionSidebar";

const SESSIONS = [
  { id: "s1", title: "Remote React jobs", updated_at: "2026-10-11T10:00:00.000Z" },
  { id: "s2", title: "Resume review", updated_at: "2026-10-10T10:00:00.000Z" },
];

let props: {
  onSelect: Mock<(id: string) => void>;
  onCreate: Mock<() => void>;
  onRename: Mock<(id: string, title: string) => void>;
  onDelete: Mock<(id: string) => void>;
};

beforeEach(() => {
  props = { onSelect: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
  render(<SessionSidebar sessions={SESSIONS} activeId="s1" {...props} />);
});

describe("SessionSidebar", () => {
  it("lists sessions and marks the active one", () => {
    const active = screen.getByRole("button", { name: "Remote React jobs" });

    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Resume review" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("selects a session", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Resume review" }));

    expect(props.onSelect).toHaveBeenCalledWith("s2");
  });

  it("starts a new chat", async () => {
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(props.onCreate).toHaveBeenCalled();
  });

  it("renames a session inline", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Rename Resume review" }));
    const input = screen.getByRole("textbox", { name: "Session title" });
    await userEvent.clear(input);
    await userEvent.type(input, "  Stripe prep {Enter}");

    expect(props.onRename).toHaveBeenCalledWith("s2", "Stripe prep");
    expect(screen.queryByRole("textbox", { name: "Session title" })).not.toBeInTheDocument();
  });

  it("does not save an empty title", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Rename Resume review" }));
    const input = screen.getByRole("textbox", { name: "Session title" });
    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");

    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("cancels renaming with Escape", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Rename Resume review" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Session title" }), "x{Escape}");

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resume review" })).toBeInTheDocument();
  });

  it("deletes a session after confirmation", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Delete Resume review" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Resume review");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(props.onDelete).toHaveBeenCalledWith("s2");
  });

  it("does not delete when the confirmation is cancelled", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Delete Resume review" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(props.onDelete).not.toHaveBeenCalled();
  });
});
