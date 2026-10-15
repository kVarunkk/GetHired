import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AllProfileWithRelations } from "@/utils/types";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { JOB_POST, explanationOf } from "@/test/utils/matching";
import ProfileItem from "./ProfileItem";

vi.mock("./ProfileFavoriteStar", () => ({ default: () => null }));
vi.mock("./pipeline/AddToListMenu", () => ({
  default: ({ candidateUserId }: { candidateUserId: string }) => <button>Add to list {candidateUserId}</button>,
}));
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: vi.fn(), show: vi.fn(), dialog: null }),
}));

const SUMMARY = explanationOf().summary;

const profileWith = (match?: Record<string, unknown>) =>
  ({
    ...PUBLIC_APPLICANT.info,
    job_relevant_profiles: match ? [{ relevance_rank: 1, ...match }] : undefined,
  }) as unknown as AllProfileWithRelations;

const renderItem = (profile: AllProfileWithRelations, jobPostId: string | null) =>
  render(<ProfileItem profile={profile} isSuitable={!!jobPostId} isFavorite={false} jobPostId={jobPostId} />);

describe("ProfileItem match details (MT-REQ-004)", () => {
  it("shows the match score badge in job context", () => {
    renderItem(profileWith({ match_score: 82, explanation: null }), JOB_POST.id);

    expect(screen.getByText("82 · Strong")).toBeInTheDocument();
  });

  it("shows the explanation summary under the name", () => {
    renderItem(
      profileWith({ match_score: 82, explanation: explanationOf(), explanation_status: "completed" }),
      JOB_POST.id,
    );

    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
  });

  it("shows neither outside job context", () => {
    renderItem(profileWith({ match_score: 82, explanation: explanationOf() }), null);

    expect(screen.queryByText(/· Strong/)).not.toBeInTheDocument();
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  });

  it("shows no badge when the candidate has no score", () => {
    renderItem(profileWith({ match_score: null, explanation: null }), JOB_POST.id);

    expect(screen.queryByLabelText(/Match score/)).not.toBeInTheDocument();
  });

  it("ignores an explanation without a summary", () => {
    renderItem(profileWith({ match_score: 70, explanation: { strengths: [] } }), JOB_POST.id);

    expect(screen.getByText("70 · Plausible")).toBeInTheDocument();
  });

  it("still renders the candidate's name and details", () => {
    renderItem(profileWith(), null);

    expect(screen.getByText(PUBLIC_APPLICANT.info.full_name!)).toBeInTheDocument();
    expect(screen.getByText("4 Years")).toBeInTheDocument();
  });
});

describe("ProfileItem 'Why?' (MT-TASK-011)", () => {
  it("offers 'Why?' in job context when there's no explanation", () => {
    renderItem(profileWith({ match_score: 82, explanation: null, explanation_status: "none" }), JOB_POST.id);

    expect(screen.getByRole("button", { name: "Why?" })).toBeInTheDocument();
  });

  it("offers it for a stale explanation too, and hides the stale summary", () => {
    renderItem(
      profileWith({ match_score: 82, explanation: explanationOf(), explanation_status: "stale" }),
      JOB_POST.id,
    );

    expect(screen.getByRole("button", { name: "Why?" })).toBeInTheDocument();
    expect(screen.queryByText(explanationOf().summary)).not.toBeInTheDocument();
  });

  it("doesn't offer it once there's a completed explanation", () => {
    renderItem(
      profileWith({ match_score: 82, explanation: explanationOf(), explanation_status: "completed" }),
      JOB_POST.id,
    );

    expect(screen.queryByRole("button", { name: "Why?" })).not.toBeInTheDocument();
  });

  it("doesn't offer it outside job context", () => {
    renderItem(profileWith({ match_score: 82, explanation: null, explanation_status: "none" }), null);

    expect(screen.queryByRole("button", { name: "Why?" })).not.toBeInTheDocument();
  });
});

describe("ProfileItem profile link", () => {
  it("carries the job into the profile page in job context", () => {
    renderItem(profileWith({ match_score: 82 }), JOB_POST.id);

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", `/company/profiles/${PUBLIC_APPLICANT.id}?job_post=${JOB_POST.id}`);
    }
  });

  it("links to the plain profile otherwise", () => {
    renderItem(profileWith(), null);

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", `/company/profiles/${PUBLIC_APPLICANT.id}`);
    }
  });
});

describe("ProfileItem talent lists (PLT-090)", () => {
  it("offers Add to list to a company, for this candidate", () => {
    const profile = profileWith();
    render(<ProfileItem profile={profile} isSuitable={false} isFavorite={false} companyId="c1" />);

    expect(screen.getByRole("button", { name: `Add to list ${profile.user_id}` })).toBeInTheDocument();
  });

  it("hides it without a company", () => {
    renderItem(profileWith(), null);

    expect(screen.queryByRole("button", { name: /Add to list/ })).not.toBeInTheDocument();
  });
});
