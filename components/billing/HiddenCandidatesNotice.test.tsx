import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HiddenCandidatesNotice from "./HiddenCandidatesNotice";

describe("HiddenCandidatesNotice (BL-REQ-023)", () => {
  it("says how many candidates the plan hides and links the upgrade", () => {
    render(<HiddenCandidatesNotice hiddenCount={37} upgradePlan={{ slug: "startup", name: "Startup" }} />);

    expect(screen.getByText("37 more matching candidates on Startup")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Startup/ })).toHaveAttribute(
      "href",
      "/company/billing?plan=startup",
    );
  });

  it("renders nothing when nothing is hidden", () => {
    const { container } = render(<HiddenCandidatesNotice hiddenCount={0} upgradePlan={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
