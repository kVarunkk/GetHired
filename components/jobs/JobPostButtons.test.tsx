import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CreateJobPostButton, EditJobPostButton } from "./JobPostButtons";

const JOB = "b0000000-0000-4000-8000-000000000001";

describe("job post buttons for members (TM-REQ-004)", () => {
  it("locks Create without jobs.create", () => {
    render(<CreateJobPostButton disabled />);

    expect(screen.getByRole("button", { name: /Create New Job Post/ })).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("locks Edit and shows why on focus", async () => {
    render(<EditJobPostButton jobPostId={JOB} disabled />);

    const button = screen.getByRole("button", { name: "Edit Job Post" });
    expect(button).toBeDisabled();
    fireEvent.focus(button.parentElement!);
    expect((await screen.findAllByText("Your role can't edit job posts.")).length).toBeGreaterThan(0);
  });

  it("links to the form pages for owners and admins", () => {
    render(
      <>
        <CreateJobPostButton />
        <EditJobPostButton jobPostId={JOB} />
      </>,
    );

    expect(screen.getByRole("link", { name: /Create New Job Post/ })).toHaveAttribute("href", "/company/job-posts/new");
    expect(screen.getByRole("link", { name: "Edit Job Post" })).toHaveAttribute("href", `/company/job-posts/${JOB}/edit`);
  });
});
