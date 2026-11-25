import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { upsertJobPostingAction } from "@/app/actions/upsert-job-posting";
import { setJobPostStateAction } from "@/app/actions/set-job-post-state";
import { listQuestionSetsAction } from "@/app/actions/question-sets/list-question-sets";
import { formFromLegacyQuestions } from "@/helpers/jobs/application-form-schema";

import JobPostingForm from "./JobPostingForm";

const push = vi.fn();
vi.mock("@/app/actions/upsert-job-posting", () => ({ upsertJobPostingAction: vi.fn() }));
vi.mock("@/app/actions/set-job-post-state", () => ({ setJobPostStateAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/LocationSearchSelect", () => ({
  default: ({ name, onChange }: { name: string; onChange: (name: string, v: string[]) => void }) => (
    <button type="button" data-testid="location" onClick={() => onChange(name, ["remote"])} />
  ),
}));
vi.mock("@/app/actions/question-sets/list-question-sets", () => ({ listQuestionSetsAction: vi.fn() }));
vi.mock("@/app/actions/question-sets/save-question-set", () => ({ saveQuestionSetAction: vi.fn() }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

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

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    const { values, existingPostingId } = vi.mocked(upsertJobPostingAction).mock.calls[0][0];
    expect(existingPostingId).toBe(EXISTING.id);
    expect(values).not.toHaveProperty("questions");
    expect(values).not.toHaveProperty("id");
    expect(values).toMatchObject({ department: "Engineering", workplace_type: "hybrid" });
    expect(values.application_form?.questions.map((q) => q.label)).toEqual(["Can you relocate?", "Why us?"]);
    expect(values.application_form?.questions[0].knockout).toEqual(LOADED.questions[0].knockout);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/job-posts/${EXISTING.id}`));
    // The full form renders slowly in jsdom, so this can pass 5s under a full parallel run.
  }, 15_000);

  it("doesn't save an invalid form", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Every question needs a label."));
    expect(upsertJobPostingAction).not.toHaveBeenCalled();
  });

  it("goes back without saving on Cancel", () => {
    render(
      <JobPostingForm companyId={COMPANY_ID} initialForm={formFromLegacyQuestions([])} cancelHref="/company/job-posts" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(push).toHaveBeenCalledWith("/company/job-posts");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
});

describe("JobPostingForm pipeline (JPT-034, JP-REQ-003)", () => {
  const DEFAULT_ID = "e0000000-0000-4000-8000-000000000001";
  const ENGINEERING_ID = "e0000000-0000-4000-8000-000000000002";
  const PIPELINES = [
    { id: DEFAULT_ID, name: "Default", isDefault: true },
    { id: ENGINEERING_ID, name: "Engineering", isDefault: false },
  ];

  function renderEditWithPipeline(hasApplications: boolean) {
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={{ ...EXISTING, pipeline_id: DEFAULT_ID }}
        initialForm={LOADED}
        answeredQuestionIds={[qid(1)]}
        cancelHref={`/company/job-posts/${EXISTING.id}`}
        pipelines={PIPELINES}
        hasApplications={hasApplications}
      />,
    );
  }

  const submittedValues = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    return vi.mocked(upsertJobPostingAction).mock.calls[0][0].values;
  };

  it("starts a new job on the company's default pipeline", () => {
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        initialForm={formFromLegacyQuestions([])}
        cancelHref="/company/job-posts"
        pipelines={[PIPELINES[1], PIPELINES[0]]}
      />,
    );
    const select = screen.getByLabelText("Pipeline");
    expect(select).toHaveValue(DEFAULT_ID);
    expect(within(select).getByRole("option", { name: "Default (default)" })).toBeInTheDocument();
  });

  it("sends the picked pipeline for a job with no applications", async () => {
    renderEditWithPipeline(false);
    fireEvent.change(screen.getByLabelText("Pipeline"), { target: { value: ENGINEERING_ID } });

    expect(await submittedValues()).toMatchObject({ pipeline_id: ENGINEERING_ID });
  }, 15_000);

  it("doesn't send an unchanged pipeline", async () => {
    renderEditWithPipeline(false);
    expect(await submittedValues()).not.toHaveProperty("pipeline_id");
  }, 15_000);

  it("on a job with applications, points to the switch page instead of sending the pipeline", async () => {
    renderEditWithPipeline(true);
    fireEvent.change(screen.getByLabelText("Pipeline"), { target: { value: ENGINEERING_ID } });

    const link = screen.getByRole("link", { name: "Switch the pipeline" });
    expect(link).toHaveAttribute(
      "href",
      `/company/job-posts/${EXISTING.id}/pipeline/switch?to=${ENGINEERING_ID}`,
    );
    expect(await submittedValues()).not.toHaveProperty("pipeline_id");
  }, 15_000);

  it("shows no pipeline field without pipelines", () => {
    renderEdit();
    expect(screen.queryByLabelText("Pipeline")).not.toBeInTheDocument();
  });
});

describe("JobPostingForm drafts and publishing (JLT-024, JL-REQ-030)", () => {
  const NEW_ID = "b0000000-0000-4000-8000-000000000009";
  const opened = { ok: true as const, changed: true, from: "draft" as const, state: "open" as const, jobId: null };

  function renderNew(canPublish = true) {
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={undefined}
        initialForm={formFromLegacyQuestions([])}
        cancelHref="/company/job-posts"
        canPublish={canPublish}
      />,
    );
  }

  function renderState(state: "draft" | "open" | "paused", canPublish = true) {
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={{ ...EXISTING, openings: 3 }}
        initialForm={LOADED}
        answeredQuestionIds={[qid(1)]}
        cancelHref={`/company/job-posts/${EXISTING.id}`}
        state={state}
        canPublish={canPublish}
      />,
    );
  }

  it("offers Save draft and Publish for a draft", () => {
    renderState("draft");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("hides Publish without jobs.publish", () => {
    renderNew(false);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it.each(["open", "paused"] as const)("keeps Save for a %s job", (state) => {
    renderState(state);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("loads and sends the openings", async () => {
    renderState("open");
    const openings = screen.getByLabelText("Openings");
    expect(openings).toHaveValue(3);
    fireEvent.change(openings, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    expect(vi.mocked(upsertJobPostingAction).mock.calls[0][0].values).toMatchObject({ openings: 5 });
    expect(setJobPostStateAction).not.toHaveBeenCalled();
  }, 15_000);

  it("refuses openings outside 1-500", async () => {
    renderState("open");
    fireEvent.change(screen.getByLabelText("Openings"), { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Openings must be at least 1.")).toBeInTheDocument();
    expect(upsertJobPostingAction).not.toHaveBeenCalled();
  }, 15_000);

  it("Save draft saves without opening", async () => {
    renderState("draft");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/job-posts/${EXISTING.id}`));
    expect(setJobPostStateAction).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Draft saved.", expect.anything());
  }, 15_000);

  it("Publish saves first, then opens the job", async () => {
    vi.mocked(setJobPostStateAction).mockResolvedValue(opened);
    renderState("draft");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(setJobPostStateAction).toHaveBeenCalledWith({ jobPostId: EXISTING.id, to: "open" }));
    expect(vi.mocked(upsertJobPostingAction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setJobPostStateAction).mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/job-posts/${EXISTING.id}`));
    expect(toast.success).toHaveBeenCalledWith("Job published.", expect.anything());
  }, 15_000);

  it("Submit for approval replaces Publish and submits the saved draft (JLT-053, JL-REQ-020)", async () => {
    vi.mocked(setJobPostStateAction).mockResolvedValue({ ...opened, state: "pending_approval" });
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={{ ...EXISTING, openings: 3 }}
        initialForm={LOADED}
        answeredQuestionIds={[qid(1)]}
        cancelHref={`/company/job-posts/${EXISTING.id}`}
        state="draft"
        canPublish
        submitForApproval
      />,
    );
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    await waitFor(() =>
      expect(setJobPostStateAction).toHaveBeenCalledWith({ jobPostId: EXISTING.id, to: "pending_approval" }),
    );
    expect(vi.mocked(upsertJobPostingAction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setJobPostStateAction).mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Job submitted for approval.", expect.anything()));
  }, 15_000);

  it("doesn't open the job when saving failed", async () => {
    vi.mocked(upsertJobPostingAction).mockResolvedValue({ success: false, error: "Job title is required." });
    renderState("draft");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Job title is required."));
    expect(setJobPostStateAction).not.toHaveBeenCalled();
  }, 15_000);

  it("at the plan's limit, keeps the draft saved and stays on the form", async () => {
    vi.mocked(upsertJobPostingAction).mockResolvedValue({ success: true, isUpdate: false, postingId: NEW_ID });
    vi.mocked(setJobPostStateAction).mockResolvedValue({
      ok: false,
      error: {
        code: "entitlement",
        message: "Your plan allows 1 active job posts. Upgrade to add more.",
        key: "active_job_posts",
        kind: "limit",
        amount: 1,
      },
    } as never);
    renderNew();
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Backend Engineer" } });
    fireEvent.change(screen.getByLabelText("Job Description"), { target: { value: EXISTING.description } });
    fireEvent.click(screen.getByTestId("location"));
    fireEvent.change(screen.getByRole("option", { name: "Fulltime" }).closest("select")!, {
      target: { value: "Fulltime" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved as a draft."));
    expect(push).not.toHaveBeenCalled();

    // A second Publish updates the saved draft instead of creating another job
    // (the upgrade dialog hides the page from the accessibility tree).
    fireEvent.click(screen.getByRole("button", { name: "Publish", hidden: true }));
    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(upsertJobPostingAction).mock.calls[0][0].existingPostingId).toBeUndefined();
    expect(vi.mocked(upsertJobPostingAction).mock.calls[1][0].existingPostingId).toBe(NEW_ID);
  }, 15_000);

  it("shows any other refusal and keeps the draft", async () => {
    vi.mocked(setJobPostStateAction).mockResolvedValue({ ok: false, error: "Your role can't publish this job." });
    renderState("draft");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Saved as a draft, but it couldn't be published. Your role can't publish this job.",
        expect.anything(),
      ),
    );
    expect(push).not.toHaveBeenCalled();
  }, 15_000);
});

describe("JobPostingForm closing date (JLT-040, JL-REQ-014)", () => {
  function renderWith(state: "draft" | "open" | "filled", closes_at: string | null, timeZone: string | null = null) {
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={{ ...EXISTING, openings: 1, closes_at }}
        initialForm={LOADED}
        cancelHref={`/company/job-posts/${EXISTING.id}`}
        state={state}
        timeZone={timeZone}
      />,
    );
  }
  const sentValues = () => vi.mocked(upsertJobPostingAction).mock.calls[0][0].values;
  const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

  it("loads the date and sends a new one", async () => {
    renderWith("open", "2099-01-01");
    const input = screen.getByLabelText("Closing date");
    expect(input).toHaveValue("2099-01-01");
    fireEvent.change(input, { target: { value: "2099-02-01" } });

    save();

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    expect(sentValues()).toMatchObject({ closes_at: "2099-02-01" });
  }, 15_000);

  it("sends null when there's no date, and Clear empties it", async () => {
    renderWith("open", "2099-01-01");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Closing date")).toHaveValue("");

    save();

    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    expect(sentValues()).toMatchObject({ closes_at: null });
  }, 15_000);

  it("refuses a past date without saving", async () => {
    renderWith("open", null, "Asia/Kolkata");
    fireEvent.change(screen.getByLabelText("Closing date"), { target: { value: "2020-01-01" } });

    save();

    expect(await screen.findByText("The closing date must be today or later.")).toBeInTheDocument();
    expect(upsertJobPostingAction).not.toHaveBeenCalled();
  }, 15_000);

  it("keeps a saved date that has passed", async () => {
    renderWith("open", "2020-01-01");
    save();
    await waitFor(() => expect(upsertJobPostingAction).toHaveBeenCalled());
    expect(sentValues()).toMatchObject({ closes_at: "2020-01-01" });
  }, 15_000);

  it("locks the date on a filled job but still lets it be cleared", () => {
    renderWith("filled", "2099-01-01");
    expect(screen.getByLabelText("Closing date")).toBeDisabled();
    expect(screen.getByText(/A filled job keeps its closing date/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Closing date")).toHaveValue("");
  });
});

describe("JobPostingForm: who can find this job (JLT-064)", () => {
  const renderForm = (props: { linkOnlyEnabled?: boolean } = {}) =>
    render(
      <JobPostingForm
        companyId={COMPANY_ID}
        existingValues={EXISTING}
        initialForm={LOADED}
        cancelHref={`/company/job-posts/${EXISTING.id}`}
        {...props}
      />,
    );

  it("hides the field while the flag is off", () => {
    renderForm();
    expect(screen.queryByText("Who can find this job")).not.toBeInTheDocument();
  });

  it("shows it once the flag is on", () => {
    renderForm({ linkOnlyEnabled: true });
    expect(screen.getByText("Who can find this job")).toBeInTheDocument();
  });
});
