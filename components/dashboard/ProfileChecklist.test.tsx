import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { agentPromptHref, ONBOARDING_PROMPT, PROFILE_UPDATE_PROMPT } from "@/helpers/agent/prompt-draft";
import type { ProfileProgress } from "@/helpers/dashboard/summary";
import ProfileChecklist, { ProfileViews } from "./ProfileChecklist";

const partial: ProfileProgress = {
  done: 3,
  total: 7,
  percent: 43,
  missing: [
    { id: "roles", label: "Add the roles you want" },
    { id: "experience", label: "Add your years of experience" },
    { id: "locations", label: "Choose where you want to work" },
    { id: "links", label: "Link your LinkedIn or GitHub" },
  ],
};
const complete: ProfileProgress = { done: 7, total: 7, percent: 100, missing: [] };

describe("ProfileChecklist", () => {
  it("sends a user who hasn't onboarded to the assistant's onboarding", () => {
    render(<ProfileChecklist filled={false} progress={partial} profileViews={0} lastUpdated={null} />);
    expect(screen.getByRole("heading", { name: "Finish your profile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Complete with the assistant/ })).toHaveAttribute(
      "href",
      agentPromptHref(ONBOARDING_PROMPT),
    );
    expect(screen.queryByText("Add the roles you want")).not.toBeInTheDocument();
  });

  it("lists the first three missing items and folds the rest", () => {
    render(<ProfileChecklist filled progress={partial} profileViews={0} lastUpdated="3 days ago" />);
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("Choose where you want to work")).toBeInTheDocument();
    expect(screen.queryByText("Link your LinkedIn or GitHub")).not.toBeInTheDocument();
    expect(screen.getByText("and 1 more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Update with the assistant/ })).toHaveAttribute(
      "href",
      agentPromptHref(PROFILE_UPDATE_PROMPT),
    );
  });

  it("says when the profile is complete and when it was last updated", () => {
    render(<ProfileChecklist filled progress={complete} profileViews={0} lastUpdated="3 days ago" />);
    expect(screen.getByRole("heading", { name: "Your profile is complete" })).toBeInTheDocument();
    expect(screen.getByText(/Last updated 3 days ago/)).toBeInTheDocument();
  });
});

describe("ProfileViews (ORT-051, OR-REQ-021)", () => {
  it("shows how many companies viewed the profile in the last 30 days", () => {
    const { container } = render(<ProfileViews count={4} />);
    expect(container.textContent).toBe("4 companies viewed your profile in the last 30 days");
  });

  it("uses the singular for one company", () => {
    const { container } = render(<ProfileViews count={1} />);
    expect(container.textContent).toBe("1 company viewed your profile in the last 30 days");
  });

  it("renders nothing at 0", () => {
    const { container } = render(<ProfileViews count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
