import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SetupProgress } from "@/helpers/company-dashboard/summary";
import SetupChecklist, { setupDismissedKey } from "./SetupChecklist";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const progress: SetupProgress = {
  done: 1,
  total: 2,
  items: [
    { key: "profileComplete", label: "Add your logo and description", href: "/get-started?company=true", done: true },
    { key: "hasOpenedJob", label: "Post your first job", href: "/company/job-posts/new", done: false },
  ],
};

beforeEach(() => window.localStorage.clear());

describe("SetupChecklist (CD-REQ-029/030)", () => {
  it("shows progress and links what's left", () => {
    render(<SetupChecklist companyId="c1" progress={progress} />);

    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post your first job" })).toHaveAttribute("href", "/company/job-posts/new");
    expect(screen.queryByRole("link", { name: "Add your logo and description" })).not.toBeInTheDocument();
  });

  it("stays dismissed, for that company only", () => {
    const first = render(<SetupChecklist companyId="c1" progress={progress} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the setup checklist" }));
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(setupDismissedKey("c1"))).toBe("1");
    first.unmount();

    const again = render(<SetupChecklist companyId="c1" progress={progress} />);
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
    again.unmount();

    render(<SetupChecklist companyId="c2" progress={progress} />);
    expect(screen.getByText("Finish setting up")).toBeInTheDocument();
  });

  it("is gone once everything is done", () => {
    render(<SetupChecklist companyId="c1" progress={{ ...progress, done: 2 }} />);

    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });
});
