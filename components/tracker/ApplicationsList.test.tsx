import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { setExternalApplicationStatusAction } from "@/app/actions/applications/set-external-application-status";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import ApplicationsList from "./ApplicationsList";

vi.mock("@/app/actions/tracker/set-tracked-status", () => ({ setTrackedStatusAction: vi.fn() }));
vi.mock("@/app/actions/applications/set-external-application-status", () => ({ setExternalApplicationStatusAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh }),
  usePathname: () => "/my-jobs",
  useSearchParams: () => new URLSearchParams("view=list"),
}));
vi.mock("@/components/ui/responsive-select", () => import("@/test/utils/select-mock"));
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

  it("changes a tracked row's status from its dropdown", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: true } as never);
    render(<ApplicationsList items={items} />);
    const select = screen.getByLabelText("Status of New role") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "interviewing" } });
    expect((screen.getByLabelText("Status of New role") as HTMLSelectElement).value).toBe("interviewing");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(setTrackedStatusAction).toHaveBeenCalledWith({ id: "new", status: "interviewing" });
  });

  it("puts the status back and says why when the save fails", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: false, error: "Nope." } as never);
    render(<ApplicationsList items={items} />);
    const select = screen.getByLabelText("Status of Old role") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "offer" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    await waitFor(() => expect((screen.getByLabelText("Status of Old role") as HTMLSelectElement).value).toBe("applied"));
  });

  it("saves an old external row through its board job", async () => {
    vi.mocked(setExternalApplicationStatusAction).mockResolvedValue({ ok: true });
    const legacy = trackerItem({ id: "leg", jobTitle: "Legacy role", legacy: true, allJobsId: "job-9" });
    render(<ApplicationsList items={[legacy]} />);
    fireEvent.change(screen.getByLabelText("Status of Legacy role"), { target: { value: "rejected" } });
    await waitFor(() => expect(setExternalApplicationStatusAction).toHaveBeenCalledWith({ allJobsId: "job-9", status: "rejected" }));
  });

  it("gives GetHired rows no dropdown", () => {
    render(<ApplicationsList items={items} />);
    expect(screen.queryByLabelText("Status of Platform Engineer")).toBeNull();
  });

  it("says so when there are none", () => {
    render(<ApplicationsList items={[]} />);
    expect(screen.getByText("No applications yet.")).toBeTruthy();
  });
});
