import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { reviewJobApprovalAction } from "@/app/actions/review-job-approval";
import { setJobPostStateAction } from "@/app/actions/set-job-post-state";
import JobApprovalNotice, { type JobApprovalNoticeStatus } from "./JobApprovalNotice";

vi.mock("@/app/actions/set-job-post-state", () => ({ setJobPostStateAction: vi.fn() }));
vi.mock("@/app/actions/review-job-approval", () => ({ reviewJobApprovalAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-hot-toast", () => {
  const toastFn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toastFn };
});
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
const PENDING: JobApprovalNoticeStatus = {
  kind: "pending",
  submittedAt: "2026-11-20T10:00:00.000Z",
  submitterName: "Pat Publisher",
  editedAfterSubmission: false,
};
const APPROVER = { canPublish: true, canApprove: true, approvalRequired: true };
const SUBMITTER = { canPublish: true, canApprove: false, approvalRequired: true, isSubmitter: true };
const OK = { ok: true as const, changed: true, from: "pending_approval" as const, state: "open" as const, jobId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reviewJobApprovalAction).mockResolvedValue(OK);
  vi.mocked(setJobPostStateAction).mockResolvedValue({ ...OK, state: "draft" });
});

describe("JobApprovalNotice (JLT-053)", () => {
  it("shows the submission and offers an approver Approve and Request changes", async () => {
    render(<JobApprovalNotice job={JOB} status={PENDING} viewer={APPROVER} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for approval");
    expect(screen.getByRole("status")).toHaveTextContent("Submitted by Pat Publisher on November 20th, 2026.");
    expect(screen.queryByText(/Edited after it was submitted/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(reviewJobApprovalAction).toHaveBeenCalledWith({ jobPostId: JOB.id, decision: "approve", note: null }),
    );
  });

  it("asks an approver for a note before sending the job back", async () => {
    render(<JobApprovalNotice job={JOB} status={PENDING} viewer={APPROVER} />);
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Add the salary range" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Send back")!);
    await waitFor(() =>
      expect(reviewJobApprovalAction).toHaveBeenCalledWith({
        jobPostId: JOB.id,
        decision: "request_changes",
        note: "Add the salary range",
      }),
    );
  });

  it("offers the submitter only Withdraw", async () => {
    render(<JobApprovalNotice job={JOB} status={PENDING} viewer={SUBMITTER} />);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() =>
      expect(setJobPostStateAction).toHaveBeenCalledWith(expect.objectContaining({ jobPostId: JOB.id, to: "draft" })),
    );
    expect(reviewJobApprovalAction).not.toHaveBeenCalled();
  });

  it("offers no buttons to another member without jobs.approve", () => {
    render(
      <JobApprovalNotice job={JOB} status={PENDING} viewer={{ canPublish: true, canApprove: false, approvalRequired: true }} />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("says when the job was edited after it was submitted", () => {
    render(<JobApprovalNotice job={JOB} status={{ ...PENDING, editedAfterSubmission: true }} viewer={APPROVER} />);
    expect(screen.getByText(/Edited after it was submitted/)).toBeInTheDocument();
  });

  it("shows the approver's note on a draft sent back", () => {
    render(
      <JobApprovalNotice
        job={JOB}
        status={{ kind: "changes_requested", note: "Add the salary range", at: "2026-11-21T09:00:00.000Z", byName: "Ada Approver" }}
        viewer={SUBMITTER}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Changes requested by Ada Approver on November 21st, 2026");
    expect(screen.getByText("Add the salary range")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
