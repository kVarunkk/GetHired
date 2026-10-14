import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MatchScoreBadge from "./MatchScoreBadge";

describe("MatchScoreBadge (MT-GUD-001)", () => {
  it("shows the score with its band word", () => {
    render(<MatchScoreBadge score={82} />);

    expect(screen.getByText("82 · Strong")).toBeInTheDocument();
  });

  it.each([
    [100, "Exceptional"],
    [90, "Exceptional"],
    [89, "Strong"],
    [75, "Strong"],
    [74, "Plausible"],
    [60, "Plausible"],
    [59, "Weak"],
    [40, "Weak"],
    [39, "Poor"],
    [0, "Poor"],
  ])("puts %i in the %s band", (score, word) => {
    render(<MatchScoreBadge score={score} />);

    expect(screen.getByText(`${score} · ${word}`)).toBeInTheDocument();
  });

  it("renders nothing without a score", () => {
    const { container } = render(<MatchScoreBadge score={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([95, 20])("uses the neutral outline badge, never status colours (%i)", (score) => {
    render(<MatchScoreBadge score={score} />);

    const badge = screen.getByText(new RegExp(`^${score} ·`));
    expect(badge.className).not.toMatch(/destructive|success|warning|green|red|brand/);
    expect(badge).toHaveClass("text-foreground");
  });

  it("labels the badge for screen readers", () => {
    render(<MatchScoreBadge score={82} />);

    expect(screen.getByLabelText("Match score 82 out of 100, strong")).toBeInTheDocument();
  });
});
