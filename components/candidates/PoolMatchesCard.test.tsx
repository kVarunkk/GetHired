import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import type { PoolMatch } from "@/helpers/candidates/pool-matches";
import PoolMatchesCard from "./PoolMatchesCard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/add-candidates-to-job", () => ({ addCandidatesToJobAction: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-000000000001";
const STAGE = "5a000000-0000-4000-8000-000000000002";
const match = (n: number, overrides: Partial<PoolMatch> = {}): PoolMatch => ({
  id: `cc000000-0000-4000-8000-00000000000${n}`,
  name: `Person ${n}`,
  title: `Engineer ${n}`,
  location: "pune",
  experienceYears: 3,
  skills: ["Go"],
  hasEmail: true,
  hasResume: true,
  similarity: 0.8,
  score: 86,
  ...overrides,
});
const MEERA = match(1, { name: "Meera Iyer", score: 91 });
const RAVI = match(2, { name: "Ravi Kumar", hasEmail: false, hasResume: false, score: 40 });
const ASHA = match(3, { name: "Asha Rao" });

type Props = Parameters<typeof PoolMatchesCard>[0];
const renderCard = (props: Partial<Props> = {}) =>
  render(
    <PoolMatchesCard
      jobId={JOB}
      status="ok"
      matches={[MEERA, RAVI, ASHA]}
      stages={[
        { id: "5a000000-0000-4000-8000-000000000001", name: "Applied" },
        { id: STAGE, name: "Phone screen" },
      ]}
      {...props}
    />,
  );
const row = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

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

describe("PoolMatchesCard (CPT-053, CP-REQ-060)", () => {
  it("lists each match with its similarity and badges, linking the candidate", () => {
    renderCard();

    expect(screen.getByRole("region", { name: "From your candidates" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meera Iyer" })).toHaveAttribute("href", `/company/candidates/${MEERA.id}`);
    const meera = within(row("Meera Iyer"));
    expect(meera.getByText("Engineer 1")).toBeInTheDocument();
    expect(meera.getByText("pune")).toBeInTheDocument();
    expect(meera.getByText("Similarity 91")).toBeInTheDocument();
    expect(meera.getByText("Resume")).toBeInTheDocument();
    expect(meera.queryByText("No email")).not.toBeInTheDocument();
    const ravi = within(row("Ravi Kumar"));
    expect(ravi.getByText("No email")).toBeInTheDocument();
    expect(ravi.queryByText("Resume")).not.toBeInTheDocument();
  });

  it("adds one candidate in the picked stage", async () => {
    renderCard();

    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: STAGE } });
    fireEvent.click(within(row("Meera Iyer")).getByRole("button", { name: "Add Meera Iyer to the job" }));

    await waitFor(() =>
      expect(addCandidatesToJobAction).toHaveBeenCalledWith({ jobPostId: JOB, candidateIds: [MEERA.id], stageId: STAGE }),
    );
    expect(toast.success).toHaveBeenCalledWith("1 candidate added to the job");
    expect(refresh).toHaveBeenCalled();
  });

  it("uses the job's first stage by default", async () => {
    renderCard();
    fireEvent.click(within(row("Asha Rao")).getByRole("button", { name: "Add Asha Rao to the job" }));
    await waitFor(() =>
      expect(addCandidatesToJobAction).toHaveBeenCalledWith({ jobPostId: JOB, candidateIds: [ASHA.id] }),
    );
  });

  it("can't add or select someone without an email", () => {
    renderCard();

    const add = within(row("Ravi Kumar")).getByRole("button", { name: "Add Ravi Kumar to the job" });
    expect(add).toBeDisabled();
    expect(add.closest("[title]")).toHaveAttribute("title", "Add an email first");
    expect(within(row("Ravi Kumar")).getByRole("checkbox")).toBeDisabled();
  });

  it("adds the selected candidates at once", async () => {
    renderCard();

    expect(screen.queryByRole("button", { name: /Add selected/ })).not.toBeInTheDocument();
    fireEvent.click(within(row("Meera Iyer")).getByRole("checkbox"));
    fireEvent.click(within(row("Asha Rao")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add selected (2)" }));

    await waitFor(() =>
      expect(addCandidatesToJobAction).toHaveBeenCalledWith({ jobPostId: JOB, candidateIds: [MEERA.id, ASHA.id] }),
    );
  });

  it("shows the action's error", async () => {
    vi.mocked(addCandidatesToJobAction).mockResolvedValue({ ok: false, error: "Your role can't import applicants here." });
    renderCard();
    fireEvent.click(within(row("Meera Iyer")).getByRole("button", { name: "Add Meera Iyer to the job" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't import applicants here."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no adding without applicants.import", () => {
    renderCard({ stages: null });
    expect(screen.queryByRole("button", { name: /to the job/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stage")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meera Iyer" })).toBeInTheDocument();
  });

  it("says it's still looking while the job has no embedding", () => {
    renderCard({ status: "no_job_embedding", matches: [] });
    expect(screen.getByText(/Finding matches…/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when nobody matches", () => {
    renderCard({ matches: [] });
    expect(screen.getByText("No one in your candidates is close to this job yet.")).toBeInTheDocument();
  });
});
