import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { setJobPostStateAction } from "@/app/actions/set-job-post-state";
import FillJobNotice from "./FillJobNotice";
import { toastFillSuggestions } from "./fill-suggestion-toast";

const refresh = vi.fn();
vi.mock("@/app/actions/set-job-post-state", () => ({ setJobPostStateAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("react-hot-toast", () => {
  const toastFn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toastFn };
});
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer", openings: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setJobPostStateAction).mockResolvedValue({
    ok: true,
    changed: true,
    from: "open",
    state: "filled",
    jobId: null,
  });
});

describe("FillJobNotice (JLT-023, JL-REQ-013)", () => {
  it("says the hires reached the openings and marks the job filled through the dialog", async () => {
    render(<FillJobNotice job={JOB} hires={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("You've hired 2 of 2 for this job.");

    fireEvent.click(screen.getByRole("button", { name: "Mark as filled" }));
    const dialog = await screen.findByRole("dialog");
    // Filling takes no reason (JL-REQ-002), and there are no AI interviews to cancel.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => /filled/i.test(b.textContent ?? ""))!,
    );

    await waitFor(() =>
      expect(setJobPostStateAction).toHaveBeenCalledWith({
        jobPostId: JOB.id,
        to: "filled",
        reason: null,
        note: null,
        cancelOpenInterviews: false,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Job marked as filled."));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("toastFillSuggestions (JLT-023)", () => {
  it("shows one toast per job, keyed by the job", () => {
    toastFillSuggestions([
      { jobPostId: "j1", title: "A", hires: 1, openings: 1 },
      { jobPostId: "j2", title: "B", hires: 3, openings: 2 },
    ]);
    expect(vi.mocked(toast).mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ id: "fill-j1" }),
      expect.objectContaining({ id: "fill-j2" }),
    ]);
  });

  it("does nothing without suggestions", () => {
    toastFillSuggestions(undefined);
    toastFillSuggestions([]);
    expect(toast).not.toHaveBeenCalled();
  });
});
