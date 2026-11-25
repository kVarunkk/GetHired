import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./responsive-select";
import { ResponsiveMenu, ResponsiveMenuItem, ResponsiveMenuSub } from "./responsive-menu";
import { ResponsivePopover } from "./responsive-popover";

// jsdom has no matchMedia. From sm up these are a select, a menu and a
// popover; below it each is a bottom drawer.
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop && query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function Frequency({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("weekly");
  return (
    <Select
      title="Alert frequency"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    >
      <SelectTrigger aria-label="Alert frequency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="weekly">Weekly</SelectItem>
        <SelectItem value="daily">Daily</SelectItem>
      </SelectContent>
    </Select>
  );
}

beforeEach(() => setViewport(false));

describe("ResponsiveSelect on a phone", () => {
  it("shows the chosen option before it's opened", () => {
    render(<Frequency />);
    expect(screen.getByRole("combobox", { name: "Alert frequency" })).toHaveTextContent("Weekly");
  });

  it("picks an option from a drawer and closes it", async () => {
    const onChange = vi.fn();
    render(<Frequency onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Alert frequency" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Alert frequency");
    expect(screen.getByRole("option", { name: "Weekly" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("option", { name: "Daily" }));

    expect(onChange).toHaveBeenCalledWith("daily");
    expect(screen.getByRole("combobox", { name: "Alert frequency" })).toHaveTextContent("Daily");
  });

  it("is the usual select on desktop", () => {
    setViewport(true);
    render(<Frequency />);
    expect(screen.getByRole("combobox", { name: "Alert frequency" })).toHaveTextContent("Weekly");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ResponsiveMenu on a phone", () => {
  it("lists actions, submenus included, in a drawer and runs the one tapped", async () => {
    const onMove = vi.fn();
    render(
      <ResponsiveMenu title="Engineer" trigger={<button type="button">Actions</button>}>
        <ResponsiveMenuSub label="Move to…">
          <ResponsiveMenuItem onClick={() => onMove("interviewing")}>Interviewing</ResponsiveMenuItem>
        </ResponsiveMenuSub>
        <ResponsiveMenuItem asChild>
          <a href="/edit">Edit</a>
        </ResponsiveMenuItem>
      </ResponsiveMenu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("group", { name: "Move to…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("href", "/edit");

    fireEvent.click(screen.getByRole("menuitem", { name: "Interviewing" }));
    expect(onMove).toHaveBeenCalledWith("interviewing");
  });
});

describe("ResponsivePopover on a phone", () => {
  it("opens its content in a drawer with a heading", async () => {
    render(
      <ResponsivePopover title="Mark as applied" trigger={<button type="button">Mark</button>}>
        <p>Applied on</p>
      </ResponsivePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveTextContent("Mark as applied");
    expect(drawer).toHaveTextContent("Applied on");
  });
});
