import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import ApplicationsList from "./ApplicationsList";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/my-jobs",
  useSearchParams: () => new URLSearchParams("view=list"),
}));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipContent: Pass, TooltipProvider: Pass, TooltipTrigger: Pass };
});

const items = [
  trackerItem({ id: "old", jobTitle: "Old role", companyName: "Acme", appliedAt: "2026-10-01" }),
  trackerItem({ id: "new", jobTitle: "New role", companyName: "Hooli", appliedAt: "2026-11-20" }),
  gethiredItem({ id: "gh", jobTitle: "Platform Engineer", companyName: "Globex", appliedAt: "2026-11-10" }),
];

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("ApplicationsList (AT-REQ-019)", () => {
  it("has the seven columns", () => {
    render(<ApplicationsList items={items} />);
    const headers = screen.getAllByRole("columnheader").map((node) => node.textContent?.trim());
    expect(headers).toEqual(["Company", "Title", "Status", "Source", "Applied", "Follow-up", "Updated"]);
  });

  it("sorts by applied date, newest first", () => {
    render(<ApplicationsList items={items} />);
    expect(bodyRows().map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual([
      "New role",
      "Platform Engineer",
      "Old role",
    ]);
  });

  it("links each title to its detail page and marks GetHired rows as GetHired", () => {
    render(<ApplicationsList items={items} />);
    expect(screen.getByRole("link", { name: "New role" }).getAttribute("href")).toBe("/my-jobs/applications/new");
    const row = bodyRows().find((each) => within(each).queryByText("Platform Engineer"));
    expect(within(row as HTMLElement).getByText("GetHired")).toBeTruthy();
  });

  it("filters by the keyword and explains an empty result", () => {
    const { rerender } = render(<ApplicationsList items={items} q="hooli" />);
    expect(bodyRows()).toHaveLength(1);
    rerender(<ApplicationsList items={items} q="zzz" />);
    expect(screen.getByText("No applications match your search.")).toBeTruthy();
  });

  it("says so when there are none", () => {
    render(<ApplicationsList items={[]} />);
    expect(screen.getByText("No applications yet.")).toBeTruthy();
  });
});
