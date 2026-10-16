import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProfileViewsCard from "./ProfileViewsCard";

describe("ProfileViewsCard (ORT-051, OR-REQ-021)", () => {
  it("shows how many companies viewed the profile in the last 30 days", () => {
    render(<ProfileViewsCard count={4} />);

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/companies viewed your profile in the last 30 days/)).toBeInTheDocument();
  });

  it("uses the singular for one company", () => {
    render(<ProfileViewsCard count={1} />);

    expect(screen.getByText(/^company viewed your profile/)).toBeInTheDocument();
  });

  it("renders nothing at 0", () => {
    const { container } = render(<ProfileViewsCard count={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("takes only a count, so no company name can be shown (OR-DEC-002)", () => {
    const { container } = render(<ProfileViewsCard count={2} />);

    expect(container.textContent).toBe("2companies viewed your profile in the last 30 days");
  });
});
