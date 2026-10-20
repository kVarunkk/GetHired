import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { deleteJobPostingAction } from "@/app/actions/delete-job-posting";

import DeleteJobPosting from "./DeleteJobPosting";

vi.mock("@/app/actions/delete-job-posting", () => ({ deleteJobPostingAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const ID = "b0000000-0000-4000-8000-000000000001";

function openAndConfirm() {
  fireEvent.click(screen.getByTitle("Delete Job Post"));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteJobPosting", () => {
  it("deletes through the server action and refreshes the list", async () => {
    vi.mocked(deleteJobPostingAction).mockResolvedValue({ ok: true });
    render(<DeleteJobPosting job_posting_id={ID} />);

    openAndConfirm();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(deleteJobPostingAction).toHaveBeenCalledWith({ jobPostingId: ID });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("goes back to /company from the posting's own page", async () => {
    vi.mocked(deleteJobPostingAction).mockResolvedValue({ ok: true });
    render(<DeleteJobPosting job_posting_id={ID} is_job_posting_page />);

    openAndConfirm();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/company"));
  });

  it("shows the error and keeps the dialog usable on failure", async () => {
    vi.mocked(deleteJobPostingAction).mockResolvedValue({ ok: false, error: "Job posting not found." });
    render(<DeleteJobPosting job_posting_id={ID} />);

    openAndConfirm();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Job posting not found."));
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("is disabled for a member, with the reason on focus, and opens nothing (TM-REQ-004)", async () => {
    render(<DeleteJobPosting job_posting_id={ID} disabled />);

    const button = screen.getByRole("button", { name: "Delete Job Post" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    fireEvent.focus(button.parentElement!);
    expect((await screen.findAllByText("Your role can't delete job posts.")).length).toBeGreaterThan(0);
    expect(deleteJobPostingAction).not.toHaveBeenCalled();
  });
});
