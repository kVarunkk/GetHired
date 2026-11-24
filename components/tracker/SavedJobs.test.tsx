import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { removeTrackedApplicationAction } from "@/app/actions/tracker/remove-tracked-application";
import { savedItem } from "@/test/utils/tracker";
import SavedJobs from "./SavedJobs";

vi.mock("@/app/actions/tracker/set-tracked-status", () => ({ setTrackedStatusAction: vi.fn() }));
vi.mock("@/app/actions/tracker/remove-tracked-application", () => ({ removeTrackedApplicationAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/my-jobs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("swr", () => ({ default: () => ({ data: undefined, isLoading: false }) }));
vi.mock("./KeywordSearch", () => ({ default: () => <input aria-label="Search" /> }));
vi.mock("@/components/JobItem", () => ({
  default: ({ job, appliedJob }: { job: { id: string; job_name: string }; appliedJob?: unknown }) => (
    <div data-testid="job-item" data-applied={appliedJob ? "yes" : "no"}>
      {job.job_name}
    </div>
  ),
}));
vi.mock("@/components/ConfirmDialog", () => ({
  default: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => void; confirmLabel: string }) =>
    open ? <button onClick={onConfirm}>{`Confirm ${confirmLabel}`}</button> : null,
}));
vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onClick, asChild }: { children?: ReactNode; onClick?: () => void; asChild?: boolean }) =>
      asChild ? <>{children}</> : <button onClick={onClick}>{children}</button>,
  };
});

const tracked = savedItem({ kind: "tracked", id: "t1", jobTitle: "Designer", companyName: "Hooli", jobUrl: "https://jobs.lever.co/hooli/1", notes: "Referred by Sam" } as never);
const boardJob = { id: "job-1", job_name: "Backend Engineer", company_name: "Globex" } as never;
const favorite = savedItem({ kind: "favorite", id: "job-1", allJobsId: "job-1" } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: true } as never);
  vi.mocked(removeTrackedApplicationAction).mockResolvedValue({ ok: true } as never);
});

const view = (props: Partial<Parameters<typeof SavedJobs>[0]> = {}) =>
  render(<SavedJobs items={[favorite, tracked]} boardJobs={[boardJob]} matchedIds={[]} {...props} />);

describe("SavedJobs (AT-REQ-026)", () => {
  it("shows board favorites as the feed's job cards and other jobs as compact cards", () => {
    view();

    expect(screen.getByTestId("job-item")).toHaveTextContent("Backend Engineer");
    const card = screen.getByRole("article", { name: "Designer at Hooli" });
    expect(card).toHaveTextContent("jobs.lever.co");
    expect(card).toHaveTextContent("Referred by Sam");
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("href", "https://jobs.lever.co/hooli/1");
  });

  it("filters both kinds by the keyword", () => {
    view({ q: "hooli" });
    expect(screen.queryByTestId("job-item")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Designer at Hooli" })).toBeInTheDocument();
  });

  it("shows the empty state with Discover and Add job", () => {
    view({ items: [] });

    expect(screen.getByRole("link", { name: "Go to Discover" })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: "Add job" })).toHaveAttribute("href", "/my-jobs/add?status=saved");
  });

  it("says nothing matched when a search finds nothing", () => {
    view({ q: "zzz" });
    expect(screen.getByText("No saved jobs match your search.")).toBeInTheDocument();
  });
});

describe("a job saved from elsewhere", () => {
  it("moves to Applications with the chosen date", async () => {
    view();

    fireEvent.change(screen.getByLabelText("Applied on"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Move to Applications" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved to Applications"));
    expect(setTrackedStatusAction).toHaveBeenCalledWith({ id: "t1", status: "applied", appliedAt: "2026-11-20" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the error and stays when the move fails", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: false, error: "Nope." } as never);
    view();

    fireEvent.click(screen.getByRole("button", { name: "Move to Applications" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("removes after confirming", async () => {
    view();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeTrackedApplicationAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));

    await waitFor(() => expect(removeTrackedApplicationAction).toHaveBeenCalledWith("t1"));
    expect(refresh).toHaveBeenCalled();
  });
});
