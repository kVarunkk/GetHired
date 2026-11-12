import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CandidateApplicationsTable from "./CandidateApplicationsTable";
import type { CandidateApplication } from "@/helpers/candidates/candidate-page";

const APPLICATION = {
  id: "a0000000-0000-4000-8000-000000000001",
  jobTitle: "Frontend Engineer",
  stageName: "Applied",
  createdAt: "2026-11-01T10:00:00.000Z",
} as CandidateApplication;

describe("CandidateApplicationsTable (BI-REQ-004)", () => {
  it("links each row to its application", () => {
    render(<CandidateApplicationsTable applications={[APPLICATION]} />);

    expect(screen.getByRole("link", { name: "View application for Frontend Engineer" })).toHaveAttribute(
      "href",
      `/company/applications/${APPLICATION.id}`,
    );
  });
});
