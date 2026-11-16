import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InterviewPlanEditor from "./InterviewPlanEditor";
import type { PlanItem } from "@/helpers/interviews/plan";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/actions/interviews/save-interview-plan", () => ({ saveInterviewPlanAction: vi.fn() }));
vi.mock("@/app/actions/interviews/copy-interview-plan", () => ({ copyInterviewPlanAction: vi.fn() }));
vi.mock("@/app/actions/interviews/draft-interview-plan", () => ({ draftInterviewPlanAction: vi.fn() }));
const handleEntitlement = vi.fn(async () => false);
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: handleEntitlement, show: vi.fn(), dialog: <div data-testid="upgrade" /> }),
}));

import toast from "react-hot-toast";
import { saveInterviewPlanAction } from "@/app/actions/interviews/save-interview-plan";
import { copyInterviewPlanAction } from "@/app/actions/interviews/copy-interview-plan";
import { draftInterviewPlanAction } from "@/app/actions/interviews/draft-interview-plan";

const JOB = "b0000000-0000-4000-8000-000000000001";
const OTHER_JOB = "b0000000-0000-4000-8000-000000000002";
const SCREEN = { id: "51000000-0000-4000-8000-000000000001", name: "Screening" };
const ONSITE = { id: "51000000-0000-4000-8000-000000000002", name: "Interview" };

const PLAN: PlanItem[] = [
  {
    id: "1a000000-0000-4000-8000-000000000001",
    stage_id: ONSITE.id,
    position: 0,
    name: "System design",
    duration_minutes: 60,
    instructions: "",
    default_interviewer_ids: [],
    competencies: [
      { id: "1c000000-0000-4000-8000-000000000001", position: 0, name: "Architecture", description: "", questions: ["Design X."] },
    ],
  },
];

function renderEditor(props: Partial<Parameters<typeof InterviewPlanEditor>[0]> = {}) {
  return render(
    <InterviewPlanEditor
      jobPostId={JOB}
      stages={[SCREEN, ONSITE]}
      plan={PLAN}
      members={[{ userId: "c1000000-0000-4000-8000-000000000001", name: "Rita" }]}
      canEdit
      copySources={[{ jobId: OTHER_JOB, title: "Frontend Engineer" }]}
      {...props}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("InterviewPlanEditor (IVT-013)", () => {
  it("groups interviews under their stages", () => {
    renderEditor();
    const screening = screen.getByRole("region", { name: "Screening" });
    const onsite = screen.getByRole("region", { name: "Interview" });
    expect(within(screening).getByText("No interviews in this stage.")).toBeInTheDocument();
    expect(within(onsite).getByDisplayValue("System design")).toBeInTheDocument();
    expect(within(onsite).getByDisplayValue("Architecture")).toBeInTheDocument();
  });

  it("is read-only without interview_plans.manage", () => {
    renderEditor({ canEdit: false });
    expect(screen.getByDisplayValue("System design")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add interview/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy from another job/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Draft with AI/ })).not.toBeInTheDocument();
  });

  it("Save is disabled until something changes", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  });

  it("shows the schema's message on the field and doesn't save", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add interview to Screening" }));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Give the interview a name.");
    const screening = screen.getByRole("region", { name: "Screening" });
    expect(within(screening).getByLabelText("Interview name")).toHaveAttribute("aria-invalid", "true");
    expect(saveInterviewPlanAction).not.toHaveBeenCalled();
  });

  it("saves the editor's state in stage order, keeping ids, and loads what came back", async () => {
    vi.mocked(saveInterviewPlanAction).mockResolvedValue({ ok: true, plan: PLAN });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add interview to Screening" }));
    const screening = screen.getByRole("region", { name: "Screening" });
    fireEvent.change(within(screening).getByLabelText("Interview name"), { target: { value: "Phone screen" } });
    fireEvent.change(within(screening).getByLabelText("Competency"), { target: { value: "Motivation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(saveInterviewPlanAction).toHaveBeenCalled());
    const { jobPostId, items } = vi.mocked(saveInterviewPlanAction).mock.calls[0][0];
    expect(jobPostId).toBe(JOB);
    expect(items).toEqual([
      expect.objectContaining({ stage_id: SCREEN.id, name: "Phone screen", competencies: [expect.objectContaining({ name: "Motivation" })] }),
      expect.objectContaining({ id: PLAN[0].id, stage_id: ONSITE.id, name: "System design" }),
    ]);
    expect((items as { id?: string }[])[0]).not.toHaveProperty("id");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Reset to the returned plan: clean again.
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  });

  it("shows the server's refusal", async () => {
    vi.mocked(saveInterviewPlanAction).mockResolvedValue({
      ok: false,
      error: "Your role can't edit interview plans for this job.",
    });
    renderEditor();
    fireEvent.change(screen.getByDisplayValue("System design"), { target: { value: "Design" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role can't edit interview plans for this job.");
  });

  it("removes and reorders through the reducer", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove System design" }));
    expect(screen.queryByDisplayValue("System design")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeEnabled();
  });

  it("copies another job's plan into the editor", async () => {
    vi.mocked(copyInterviewPlanAction).mockResolvedValue({
      ok: true,
      items: 1,
      droppedInterviewerIds: [],
      plan: [{ ...PLAN[0], name: "Copied interview" }],
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /Copy from another job/ }));
    fireEvent.change(await screen.findByLabelText("Copy from"), { target: { value: OTHER_JOB } });
    fireEvent.click(screen.getByRole("button", { name: "Replace plan" }));

    await waitFor(() =>
      expect(copyInterviewPlanAction).toHaveBeenCalledWith({ fromJobId: OTHER_JOB, toJobId: JOB }),
    );
    expect(await screen.findByDisplayValue("Copied interview")).toBeInTheDocument();
  });

  describe("Draft with AI (IV-REQ-050)", () => {
    const DRAFT = {
      ok: true as const,
      notes: ["Left out \"Age check\": interview plans can't be about age."],
      items: [
        {
          stage_id: SCREEN.id,
          name: "Recruiter screen",
          duration_minutes: 30,
          instructions: "Short.",
          competencies: [{ name: "Motivation", description: "Why this job", questions: ["Why us?"] }],
        },
      ],
    };

    const openAndConfirm = () => {
      fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Draft plan" }));
    };

    it("asks first, saying it replaces the plan, saves nothing, and what it costs", () => {
      renderEditor();
      fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("replaces this job's plan");
      expect(dialog).toHaveTextContent("Nothing is saved until you save");
      expect(dialog).toHaveTextContent("1 agent message");
      expect(draftInterviewPlanAction).not.toHaveBeenCalled();
    });

    it("fills the editor with the draft, unsaved, and shows what was left out", async () => {
      vi.mocked(draftInterviewPlanAction).mockResolvedValue(DRAFT);
      renderEditor();
      openAndConfirm();

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      const screening = screen.getByRole("region", { name: "Screening" });
      expect(within(screening).getByDisplayValue("Recruiter screen")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("System design")).not.toBeInTheDocument();
      expect(draftInterviewPlanAction).toHaveBeenCalledWith({ jobPostId: JOB });
      expect(saveInterviewPlanAction).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Save plan" })).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent('Left out "Age check"');
      expect(toast.success).toHaveBeenCalledWith("Draft ready. Review it, then save.");
    });

    it("shows the error and keeps the plan when drafting fails", async () => {
      vi.mocked(draftInterviewPlanAction).mockResolvedValue({ ok: false, error: "Couldn't draft an interview plan." });
      renderEditor();
      openAndConfirm();

      expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
        "Couldn't draft an interview plan.",
      );
      expect(screen.getByDisplayValue("System design")).toBeInTheDocument();
    });

    it("opens the upgrade dialog when the allowance is used up", async () => {
      const refused = { error: { code: "entitlement", key: "agent_messages" } };
      vi.mocked(draftInterviewPlanAction).mockResolvedValue(refused as never);
      handleEntitlement.mockResolvedValueOnce(true);
      renderEditor();
      openAndConfirm();

      await waitFor(() => expect(handleEntitlement).toHaveBeenCalledWith(refused));
      expect(screen.getByDisplayValue("System design")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
