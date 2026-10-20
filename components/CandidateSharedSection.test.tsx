import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CandidateSharedSection from "./CandidateSharedSection";

const REPORT = {
  summary: "Strong debugging evidence.",
  competencies: [{ name: "Debugging", score: 4, evidence: "Traced a memory leak." }],
  evidence_quotes: [{ quote: "I traced a memory leak", relevance: "Production debugging." }],
  concerns: [{ title: "Little on testing", evidence: "No tests mentioned." }],
  follow_up_questions: ["How did you verify the fix?"],
};

describe("CandidateSharedSection (ORT-064, OR-REQ-032)", () => {
  it("shows the completed company report, labelled candidate-shared and AI-generated", () => {
    render(<CandidateSharedSection interview={{ status: "completed", result: REPORT }} review={null} />);

    expect(screen.getByText("Candidate-shared")).toBeInTheDocument();
    expect(screen.getByText("Shared by the candidate · AI-generated")).toBeInTheDocument();
    expect(screen.getByText("Strong debugging evidence.")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("How did you verify the fix?")).toBeInTheDocument();
    expect(screen.queryByText(/resume review/i)).not.toBeInTheDocument();
  });

  it.each(["queued", "processing"] as const)("shows 'Report in progress' while %s", (status) => {
    render(<CandidateSharedSection interview={{ status, result: null }} review={null} />);

    expect(screen.getByText("Report in progress")).toBeInTheDocument();
  });

  it("says when the report failed", () => {
    render(<CandidateSharedSection interview={{ status: "failed", result: null }} review={null} />);

    expect(screen.getByText(/couldn't be generated/)).toBeInTheDocument();
  });

  it("shows the resume review score and summary", () => {
    render(<CandidateSharedSection interview={null} review={{ score: 82, summary: "Clear impact bullets." }} />);

    expect(screen.getByText("Resume review")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Clear impact bullets.")).toBeInTheDocument();
    expect(screen.getByText("Shared by the candidate · AI-generated")).toBeInTheDocument();
  });

  it("renders nothing when nothing was shared", () => {
    const { container } = render(<CandidateSharedSection interview={null} review={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
