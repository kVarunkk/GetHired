import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { explanationOf } from "@/test/utils/matching";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import ProfileMatches, { type CandidateMatch } from "./ProfileMatches";

vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: vi.fn(async () => false), show: vi.fn(), dialog: null }),
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const fetchMock = vi.fn();

const FRONTEND: CandidateMatch = {
  jobPostId: "b0000000-0000-4000-8000-000000000001",
  jobTitle: "Senior Frontend Engineer",
  matchScore: 82,
  explanation: explanationOf(),
};
const BACKEND: CandidateMatch = {
  jobPostId: "b0000000-0000-4000-8000-000000000002",
  jobTitle: "Backend Engineer",
  matchScore: 71,
  explanation: null,
};

const rows = () => within(screen.getByRole("list", { name: "Matches for your jobs" })).getAllByRole("listitem");
const toggle = (title: string) => screen.getByRole("button", { name: new RegExp(title) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ProfileMatches (MT-REQ-004)", () => {
  it("lists every matched job with its score and summary, in the given order", () => {
    render(<ProfileMatches candidateId={PUBLIC_APPLICANT.id} matches={[FRONTEND, BACKEND]} />);

    expect(screen.getByRole("heading", { name: /Matches for your jobs/ })).toHaveTextContent("2");
    const [first, second] = rows();
    expect(first).toHaveTextContent("Senior Frontend Engineer");
    expect(first).toHaveTextContent("82 · Strong");
    expect(first).toHaveTextContent(explanationOf().summary);
    expect(second).toHaveTextContent("Backend Engineer");
    expect(second).toHaveTextContent("71 · Plausible");
    expect(second).toHaveTextContent("No explanation yet");
  });

  it("starts collapsed except for the job in context", () => {
    render(
      <ProfileMatches
        candidateId={PUBLIC_APPLICANT.id}
        matches={[FRONTEND, BACKEND]}
        expandedJobPostId={FRONTEND.jobPostId}
      />,
    );

    expect(toggle("Senior Frontend Engineer")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("Backend Engineer")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "Strengths" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Why this match?" })).not.toBeInTheDocument();
  });

  it("expands several rows at once so roles can be compared", async () => {
    render(<ProfileMatches candidateId={PUBLIC_APPLICANT.id} matches={[FRONTEND, BACKEND]} />);

    await userEvent.click(toggle("Senior Frontend Engineer"));
    await userEvent.click(toggle("Backend Engineer"));

    expect(toggle("Senior Frontend Engineer")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("Backend Engineer")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Why this match?" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View job/ }).map((a) => a.getAttribute("href"))).toEqual([
      `/company/job-posts/${FRONTEND.jobPostId}`,
      `/company/job-posts/${BACKEND.jobPostId}`,
    ]);
  });

  it("collapses an open row", async () => {
    render(
      <ProfileMatches
        candidateId={PUBLIC_APPLICANT.id}
        matches={[FRONTEND]}
        expandedJobPostId={FRONTEND.jobPostId}
      />,
    );

    await userEvent.click(toggle("Senior Frontend Engineer"));

    expect(toggle("Senior Frontend Engineer")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Strengths" })).not.toBeInTheDocument();
  });

  it("explains a row on demand and updates its summary line", async () => {
    const generated = explanationOf({ summary: "Strong Go background, light on Kafka." });
    fetchMock.mockResolvedValue(Response.json({ explanation: generated }));
    render(<ProfileMatches candidateId={PUBLIC_APPLICANT.id} matches={[BACKEND]} />);

    await userEvent.click(toggle("Backend Engineer"));
    await userEvent.click(screen.getByRole("button", { name: "Why this match?" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/company/matches/explain",
      expect.objectContaining({
        body: JSON.stringify({ jobPostId: BACKEND.jobPostId, candidateId: PUBLIC_APPLICANT.id }),
      }),
    );
    expect(await screen.findAllByText("Strong Go background, light on Kafka.")).toHaveLength(2);
    expect(rows()[0]).not.toHaveTextContent("No explanation yet");
  });

  it("shows a row with no score, for a job in context the candidate wasn't matched to", () => {
    render(
      <ProfileMatches
        candidateId={PUBLIC_APPLICANT.id}
        matches={[{ ...BACKEND, matchScore: null }]}
      />,
    );

    expect(rows()[0]).toHaveTextContent("Backend Engineer");
    expect(rows()[0]).toHaveTextContent("Not scored");
  });

  it("renders nothing without matches", () => {
    const { container } = render(<ProfileMatches candidateId={PUBLIC_APPLICANT.id} matches={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
