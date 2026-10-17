import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import CreateJobPostingDialog from "./CreateJobPostingDialog";

vi.mock("@/app/actions/upsert-job-posting", () => ({ upsertJobPostingAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LocationSearchSelect", () => ({ default: () => <div data-testid="location" /> }));

const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";
const EXISTING = {
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Backend Engineer",
  description: "Build things.",
  location: [],
  job_type: "Fulltime" as const,
  salary_currency: "$",
  min_salary: 0,
  max_salary: 0,
  min_experience: 0,
  max_experience: 0,
  visa_sponsorship: "Not Required" as const,
  min_equity: 0,
  max_equity: 0,
  questions: [],
};

beforeEach(() => {
  // jsdom has no matchMedia; desktop renders the dialog.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("CreateJobPostingDialog for members (TM-REQ-004)", () => {
  it("disables Create and opens no form", () => {
    render(<CreateJobPostingDialog companyId={COMPANY_ID} disabled />);

    const button = screen.getByRole("button", { name: /Create New Job Post/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables Edit and shows why on focus", async () => {
    render(<CreateJobPostingDialog companyId={COMPANY_ID} existingValues={EXISTING} disabled />);

    const button = screen.getByRole("button", { name: "Edit Job Post" });
    expect(button).toBeDisabled();
    fireEvent.focus(button.parentElement!);
    expect((await screen.findAllByText("Your role can't edit job posts.")).length).toBeGreaterThan(0);
  });

  it("stays enabled for owners and admins", () => {
    render(<CreateJobPostingDialog companyId={COMPANY_ID} />);

    expect(screen.getByRole("button", { name: /Create New Job Post/ })).toBeEnabled();
  });
});
