import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { upsertJobPostingAction } from "@/app/actions/upsert-job-posting";
import { listQuestionSetsAction } from "@/app/actions/question-sets/list-question-sets";
import { formFromLegacyQuestions } from "@/helpers/jobs/application-form-schema";

import JobPostingForm from "./JobPostingForm";

const push = vi.fn();
vi.mock("@/app/actions/upsert-job-posting", () => ({ upsertJobPostingAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/LocationSearchSelect", () => ({ default: () => <div data-testid="location" /> }));
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
const qid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EXISTING = {
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Backend Engineer",
  description: "Build and run the payments platform in Go.",
  location: ["bengaluru"],
  job_type: "Fulltime" as const,
  salary_currency: "$",
  min_salary: 0,
  max_salary: 0,
  min_experience: 0,
  max_experience: 0,
  visa_sponsorship: "Not Required" as const,
  min_equity: 0,
  max_equity: 0,
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

function renderEdit() {
  render(
    <JobPostingForm
      companyId={COMPANY_ID}
      existingValues={EXISTING}
      initialForm={LOADED}
      answeredQuestionIds={[qid(1)]}
      cancelHref={`/company/job-posts/${EXISTING.id}`}
    />,
  );
  return screen.getByRole("group", { name: "Question 1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listQuestionSetsAction).mockResolvedValue({ ok: true, sets: [], canManage: false });
  vi.mocked(upsertJobPostingAction).mockResolvedValue({ success: true, isUpdate: true, postingId: EXISTING.id });
});

describe("JobPostingForm application form (CPT-020)", () => {
  it("shows the loaded form, with its rules, on the page", () => {
    const card = renderEdit();
    expect(within(card).getByLabelText("Question")).toHaveValue("Can you relocate?");
    expect(within(card).getByRole("checkbox", { name: "Knockout rule" })).toBeChecked();
  });

  it("saves the form instead of the old questions list, then opens the job", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Question 2" })).getByLabelText("Question"), {
      target: { value: "Why us?" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    const { values, existingPostingId } = vi.mocked(upsertJobPostingAction).mock.calls[0][0];
    expect(existingPostingId).toBe(EXISTING.id);
    expect(values).not.toHaveProperty("questions");
    expect(values).not.toHaveProperty("id");
    expect(values).toMatchObject({ department: "Engineering", workplace_type: "hybrid" });
    expect(values.application_form?.questions.map((q) => q.label)).toEqual(["Can you relocate?", "Why us?"]);
    expect(values.application_form?.questions[0].knockout).toEqual(LOADED.questions[0].knockout);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/job-posts/${EXISTING.id}`));
  });

  it("doesn't save an invalid form", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Every question needs a label."));
    expect(upsertJobPostingAction).not.toHaveBeenCalled();
  });

  it("goes back without saving on Cancel", () => {
    render(
      <JobPostingForm companyId={COMPANY_ID} initialForm={formFromLegacyQuestions([])} cancelHref="/company/job-posts" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(push).toHaveBeenCalledWith("/company/job-posts");
    expect(screen.getByRole("button", { name: "Post Job" })).toBeEnabled();
  });
});
