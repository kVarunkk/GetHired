import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import CandidateMatchingJobs from "./CandidateMatchingJobs";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/add-candidates-to-job", () => ({ addCandidatesToJobAction: vi.fn() }));

const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const BACKEND = { jobId: "b0000000-0000-4000-8000-000000000001", title: "Backend", similarity: 0.8, score: 86, canAdd: true };
const DATA = { jobId: "b0000000-0000-4000-8000-000000000002", title: "Data", similarity: 0.6, score: 29, canAdd: false };

type Props = Parameters<typeof CandidateMatchingJobs>[0];
const renderJobs = (props: Partial<Props> = {}) =>
  render(
    <CandidateMatchingJobs
      candidateId={CANDIDATE}
      hasEmail
      canMatch
      status="ok"
      matches={[BACKEND, DATA]}
      {...props}
    />,
  );
const row = (title: string) => screen.getByRole("link", { name: title }).closest("tr")!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addCandidatesToJobAction).mockResolvedValue({
    ok: true,
    counts: {
      created: 0,
      updated: 0,
      skipped: 0,
      known: 0,
      added_to_job: 1,
      already_in_job: 0,
      needs_outreach: 0,
      no_email: 0,
      added_to_list: 0,
      not_found: 0,
    },
  });
});

describe("CandidateMatchingJobs (CPT-055, CP-REQ-062)", () => {
  it("lists the matching jobs with their similarity, linking each", () => {
    renderJobs();

    expect(screen.getByRole("heading", { name: "Matching jobs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backend" })).toHaveAttribute("href", `/company/job-posts/${BACKEND.jobId}`);
    expect(within(row("Backend")).getByText("Similarity 86")).toBeInTheDocument();
    expect(within(row("Data")).getByText("Similarity 29")).toBeInTheDocument();
  });

  it("adds them to a job they can import into", async () => {
    renderJobs();

    expect(within(row("Data")).queryByRole("button", { name: /Add to/ })).not.toBeInTheDocument();
    fireEvent.click(within(row("Backend")).getByRole("button", { name: "Add to Backend" }));

    await waitFor(() =>
      expect(addCandidatesToJobAction).toHaveBeenCalledWith({ jobPostId: BACKEND.jobId, candidateIds: [CANDIDATE] }),
    );
    expect(toast.success).toHaveBeenCalledWith("1 candidate added to the job");
    expect(refresh).toHaveBeenCalled();
  });

  it("can't add someone without an email", () => {
    renderJobs({ hasEmail: false });
    const add = within(row("Backend")).getByRole("button", { name: "Add to Backend" });
    expect(add).toBeDisabled();
    expect(add.closest("[title]")).toHaveAttribute("title", "Add an email first");
  });

  it("says when no job is close", () => {
    renderJobs({ matches: [] });
    expect(screen.getByText("None of your open jobs is close to this person yet.")).toBeInTheDocument();
  });

  it("says when they can't be matched, instead of the list", () => {
    renderJobs({ canMatch: false, status: "not_embedded", matches: [] });
    expect(screen.getByText("Add a resume or skills to match this person to jobs.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says it's still looking before their profile is read", () => {
    renderJobs({ status: "not_embedded", matches: [] });
    expect(screen.getByText(/Finding matching jobs…/)).toBeInTheDocument();
  });

  it("says matching needs an active job instead of the loader or the list", () => {
    renderJobs({ hasOpenJobs: false, status: "not_embedded", matches: [] });
    expect(screen.getByText(/You have no active jobs/)).toBeInTheDocument();
    expect(screen.queryByText(/Finding matching jobs…/)).not.toBeInTheDocument();
    expect(screen.queryByText(/None of your open jobs/)).not.toBeInTheDocument();
  });

  it("shows only the note without talent.view", () => {
    const { container } = renderJobs({ status: null, matches: [] });
    expect(container).toBeEmptyDOMElement();
    renderJobs({ status: null, matches: [], canMatch: false });
    expect(screen.getByText("Add a resume or skills to match this person to jobs.")).toBeInTheDocument();
  });
});
