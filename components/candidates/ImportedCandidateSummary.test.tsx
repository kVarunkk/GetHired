import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { candidateOf } from "@/test/utils/candidates";
import { COMPANY_A } from "@/test/utils/recruiter";
import ImportedCandidateSummary from "./ImportedCandidateSummary";

describe("ImportedCandidateSummary (BI-REQ-030)", () => {
  it("shows the candidate's details, contact and a link to their page", () => {
    const candidate = candidateOf(COMPANY_A, {
      full_name: "Meera Iyer",
      email: "meera@mail.test",
      phone: "+91 98765 43210",
      current_title: "Backend Engineer",
      current_company: "Initech",
      location: "bengaluru",
      experience_years: 4,
      skills: ["Go", "Postgres"],
      links: { linkedin: "https://linkedin.com/in/meera" },
    });

    render(<ImportedCandidateSummary candidate={candidate} />);

    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("No resume")).toBeInTheDocument();
    expect(screen.getByText("meera@mail.test")).toBeInTheDocument();
    expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer at Initech")).toBeInTheDocument();
    expect(screen.getByText("4 years")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://linkedin.com/in/meera");
    expect(screen.getByRole("link", { name: "Open candidate" })).toHaveAttribute(
      "href",
      `/company/candidates/${candidate.id}`,
    );
  });

  it("says Not specified for what the import left blank", () => {
    render(<ImportedCandidateSummary candidate={candidateOf(COMPANY_A, { email: null })} />);
    expect(screen.getAllByText("Not specified").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "LinkedIn" })).not.toBeInTheDocument();
  });
});
