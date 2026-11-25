import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setExternalApplicationStatusAction } from "@/app/actions/applications/set-external-application-status";
import JobPageDropdown from "./JobPageDropdown";

vi.mock("@/app/actions/applications/set-external-application-status", () => ({
  setExternalApplicationStatusAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/applications/remove-external-application", () => ({
  removeExternalApplicationAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => vi.clearAllMocks());

const renderMenu = (props: Partial<Parameters<typeof JobPageDropdown>[0]> = {}) =>
  render(
    <JobPageDropdown userId="u1" jobId={JOB_ID} isCompanyUser={false} applicationStatus="applied" isPlatformJob={false} {...props} />,
  );

describe("JobPageDropdown (AT-REQ-035)", () => {
  it("lists the tracked statuses and moves the card", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Job actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Update Status" }));

    for (const label of ["Applied", "In review", "Interviewing", "Offer", "Accepted", "Rejected", "Withdrawn", "Ghosted"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("menuitem", { name: "Saved" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Interviewing" }));
    await waitFor(() => expect(setExternalApplicationStatusAction).toHaveBeenCalledWith({ allJobsId: JOB_ID, status: "interviewing" }));
  });

  it("opens the card in My Jobs, or the Applications tab for an old row", async () => {
    const user = userEvent.setup();
    const { unmount } = renderMenu({ trackedId: "10000000-0000-4000-8000-000000000001" });
    await user.click(screen.getByRole("button", { name: "Job actions" }));
    expect(screen.getByRole("menuitem", { name: "Open in My Jobs" })).toHaveAttribute(
      "href",
      "/my-jobs/applications/10000000-0000-4000-8000-000000000001",
    );
    unmount();

    renderMenu();
    await user.click(screen.getByRole("button", { name: "Job actions" }));
    expect(screen.getByRole("menuitem", { name: "Open in My Jobs" })).toHaveAttribute("href", "/my-jobs");
  });

  it("only shares an untracked job, a GetHired job or for a company", async () => {
    const user = userEvent.setup();
    for (const props of [{ applicationStatus: null }, { isPlatformJob: true }, { isCompanyUser: true }]) {
      const { unmount } = renderMenu(props);
      await user.click(screen.getByRole("button", { name: "Job actions" }));
      expect(screen.queryByRole("menuitem", { name: "Open in My Jobs" })).not.toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Share Job" })).toBeInTheDocument();
      unmount();
    }
  });
});
