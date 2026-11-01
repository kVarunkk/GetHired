import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ImportedBadge from "./ImportedBadge";

describe("ImportedBadge (BI-REQ-030)", () => {
  it("marks an imported person, and says when they have no resume", () => {
    render(<ImportedBadge person={{ imported: true, hasResume: false }} />);
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("No resume")).toHaveAttribute("title", expect.stringMatching(/can't be scored/));
  });

  it("leaves out No resume when there is one", () => {
    render(<ImportedBadge person={{ imported: true, hasResume: true }} />);
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.queryByText("No resume")).not.toBeInTheDocument();
  });

  it("links a claimed candidate's connected GetHired account (BIT-101)", () => {
    render(<ImportedBadge person={{ imported: true, hasResume: true, connectedUserId: "a0000000-0000-4000-8000-000000000001" }} />);
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GetHired account connected" })).toHaveAttribute(
      "href",
      "/company/profiles/a0000000-0000-4000-8000-000000000001",
    );
  });

  it("shows no account link for an unclaimed candidate", () => {
    render(<ImportedBadge person={{ imported: true, hasResume: true }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing for a GetHired applicant", () => {
    const { container } = render(<ImportedBadge person={{ imported: false, hasResume: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
