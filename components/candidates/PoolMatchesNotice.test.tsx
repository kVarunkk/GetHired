import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PoolMatchesNotice from "./PoolMatchesNotice";

const JOB = "b0000000-0000-4000-8000-000000000001";

describe("PoolMatchesNotice (CPT-054, CP-REQ-061)", () => {
  it("names how many may fit and links to the job's section", () => {
    render(<PoolMatchesNotice jobId={JOB} count={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 people in your candidates may fit this job.");
    expect(screen.getByRole("link", { name: "See who" })).toHaveAttribute(
      "href",
      `/company/job-posts/${JOB}/from-your-candidates`,
    );
  });

  it("says one person", () => {
    render(<PoolMatchesNotice jobId={JOB} count={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 person in your candidates may fit this job.");
  });

  it("dismisses", () => {
    render(<PoolMatchesNotice jobId={JOB} count={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
