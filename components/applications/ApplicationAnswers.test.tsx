import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ApplicationAnswers from "./ApplicationAnswers";

describe("ApplicationAnswers (AF-REQ-008)", () => {
  it("shows each label and answer, links URLs safely and marks skipped ones", () => {
    render(
      <ApplicationAnswers
        answers={[
          { key: "a", label: "Can you relocate?", type: "yes_no", text: "No", url: null },
          { key: "b", label: "Portfolio", type: "url", text: "https://ada.dev", url: "https://ada.dev" },
          { key: "c", label: "Nickname", type: "short_text", text: null, url: null },
          { key: "d", label: "Bio", type: "long_text", text: "<b>hi</b>", url: null },
        ]}
      />,
    );

    expect(screen.getByText("Can you relocate?")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://ada.dev" });
    expect(link).toHaveAttribute("rel", "nofollow noopener noreferrer ugc");
    expect(screen.getByText("Not answered")).toBeInTheDocument();
    // Rendered as text, never HTML.
    expect(screen.getByText("<b>hi</b>")).toBeInTheDocument();
  });

  it("says when nothing was asked", () => {
    render(<ApplicationAnswers answers={[]} />);
    expect(screen.getByText("No custom questions were asked for this job.")).toBeInTheDocument();
  });
});
