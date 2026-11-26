import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setJobPostStateAction } from "@/app/actions/set-job-post-state";
import type { JobPostState, MoveViewer } from "@/helpers/jobs/job-states";
import JobStateMenu from "./JobStateMenu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/actions/set-job-post-state", () => ({ setJobPostStateAction: vi.fn() }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
const PUBLISHER: MoveViewer = { canPublish: true, canApprove: false, approvalRequired: false };

function renderMenu(state: JobPostState, viewer: MoveViewer = PUBLISHER, openInterviews = 0) {
  render(
    <TooltipProvider>
      <JobStateMenu job={{ ...JOB, state }} viewer={viewer} openInterviews={openInterviews} />
    </TooltipProvider>,
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /Job state/ }));
}

const items = () => screen.queryAllByRole("menuitem").map((el) => el.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setJobPostStateAction).mockImplementation(async ({ to }) => ({
    ok: true,
    changed: true,
    from: "open",
    state: to,
    jobId: "d0000000-0000-4000-8000-000000000001",
  }));
});

describe("JobStateMenu (JLT-020)", () => {
  it("lists only the moves the viewer may make from the state", async () => {
    renderMenu("open");
    await openMenu();
    expect(items()).toEqual(["Pause", "Mark as filled…", "Close…"]);
  });

  it("offers Submit for approval instead of Publish without jobs.approve when approval is on", async () => {
    renderMenu("draft", { ...PUBLISHER, approvalRequired: true });
    await openMenu();
    expect(items()).toEqual(["Submit for approval"]);
  });

  it("is just the badge without jobs.publish", () => {
    renderMenu("open", { canPublish: false, canApprove: false, approvalRequired: false });
    expect(screen.queryByRole("button", { name: /Job state/ })).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("pauses straight away and shows the new state", async () => {
    renderMenu("open");
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
    await waitFor(() =>
      expect(setJobPostStateAction).toHaveBeenCalledWith({
        jobPostId: JOB.id,
        to: "paused",
        reason: null,
        note: null,
        cancelOpenInterviews: false,
      }),
    );
    expect(await screen.findByRole("button", { name: /Job state: Paused/ })).toBeInTheDocument();
  });

  it("closes through the dialog, with the reason and the interview choice", async () => {
    renderMenu("open", PUBLISHER, 2);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Close…" }));

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "on_hold_indefinitely" } });
    await userEvent.click(screen.getByRole("checkbox", { name: /Cancel 2 open AI interviews/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close job" }));

    await waitFor(() =>
      expect(setJobPostStateAction).toHaveBeenCalledWith({
        jobPostId: JOB.id,
        to: "closed",
        reason: "on_hold_indefinitely",
        note: null,
        cancelOpenInterviews: true,
      }),
    );
  });

  it("keeps the old state when the move is refused", async () => {
    vi.mocked(setJobPostStateAction).mockResolvedValue({ ok: false, error: "nope" });
    renderMenu("open");
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
    await waitFor(() => expect(setJobPostStateAction).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Job state: Open/ })).toBeInTheDocument();
  });
});
