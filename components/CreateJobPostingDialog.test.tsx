import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { upsertJobPostingAction } from "@/app/actions/upsert-job-posting";
import { loadJobFormAction } from "@/app/actions/jobs/load-job-form";
import { listQuestionSetsAction } from "@/app/actions/question-sets/list-question-sets";

import CreateJobPostingDialog from "./CreateJobPostingDialog";

vi.mock("@/app/actions/upsert-job-posting", () => ({ upsertJobPostingAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LocationSearchSelect", () => ({ default: () => <div data-testid="location" /> }));
vi.mock("@/app/actions/jobs/load-job-form", () => ({ loadJobFormAction: vi.fn() }));
vi.mock("@/app/actions/question-sets/list-question-sets", () => ({ listQuestionSetsAction: vi.fn() }));
vi.mock("@/app/actions/question-sets/save-question-set", () => ({ saveQuestionSetAction: vi.fn() }));
vi.mock("swr", () => ({ mutate: vi.fn() }));

// Radix's checkbox and select measure themselves; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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

describe("CreateJobPostingDialog application form (CPT-020)", () => {
  const qid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const VALID = {
    ...EXISTING,
    description: "Build and run the payments platform in Go.",
    location: ["bengaluru"],
    questions: ["Why us?"],
    department: "Engineering",
    workplace_type: "hybrid" as const,
  };
  const LOADED = {
    version: 1 as const,
    questions: [
      {
        id: qid(1),
        type: "yes_no" as const,
        label: "Can you relocate?",
        required: true,
        knockout: { fail_if: { kind: "equals" as const, value: false }, action: "flag" as const },
      },
    ],
    standard_fields: {},
  };

  async function openEditStep2() {
    render(<CreateJobPostingDialog companyId={COMPANY_ID} existingValues={VALID} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Job Post" }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    return screen.findByRole("group", { name: "Question 1" });
  }

  beforeEach(() => {
    vi.mocked(listQuestionSetsAction).mockResolvedValue({ ok: true, sets: [], canManage: false });
    vi.mocked(loadJobFormAction).mockResolvedValue({ ok: true, form: LOADED, answeredQuestionIds: [qid(1)] });
    vi.mocked(upsertJobPostingAction).mockResolvedValue({ success: true, isUpdate: true } as never);
  });

  it("loads the full form, with its rules, when an edit opens", async () => {
    const card = await openEditStep2();
    expect(loadJobFormAction).toHaveBeenCalledWith({ jobPostId: VALID.id });
    expect(within(card).getByLabelText("Question")).toHaveValue("Can you relocate?");
    expect(within(card).getByRole("checkbox", { name: "Knockout rule" })).toBeChecked();
  });

  it("saves the form instead of the old questions list", async () => {
    await openEditStep2();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Question 2" })).getByLabelText("Question"), {
      target: { value: "Why us?" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    const { values, existingPostingId } = vi.mocked(upsertJobPostingAction).mock.calls[0][0];
    expect(existingPostingId).toBe(VALID.id);
    expect(values).not.toHaveProperty("questions");
    expect(values).not.toHaveProperty("id");
    expect(values).toMatchObject({ department: "Engineering", workplace_type: "hybrid" });
    expect(values.application_form?.questions.map((q) => q.label)).toEqual(["Can you relocate?", "Why us?"]);
    expect(values.application_form?.questions[0].knockout).toEqual(LOADED.questions[0].knockout);
  });

  it("doesn't save an invalid form", async () => {
    await openEditStep2();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Every question needs a label."));
    expect(upsertJobPostingAction).not.toHaveBeenCalled();
  });
});
