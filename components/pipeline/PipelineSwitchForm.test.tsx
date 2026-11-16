import { beforeEach, describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getRedirectError } from "next/dist/client/components/redirect";
import { RedirectType } from "next/dist/client/components/redirect-error";
import { previewJobPipelineSwitchAction } from "@/app/actions/pipeline/preview-job-pipeline-switch";
import { setJobPipelineAction } from "@/app/actions/pipeline/set-job-pipeline";
import type { JobPipelineSwitchPreview, SwitchPreviewRow } from "@/helpers/pipeline/pipelines";
import PipelineSwitchForm, { NEW_PIPELINE_VALUE, NO_EMAIL_NOTE, type NewPipelineOption } from "./PipelineSwitchForm";

vi.mock("./NewPipelineDialog", () => ({
  PIPELINE_LIMIT_REACHED: "At the limit.",
  default: (props: { open: boolean; forJobId: string; initialSourceId: string }) =>
    props.open ? (
      <div role="dialog" data-job={props.forJobId} data-source={props.initialSourceId}>
        New pipeline dialog
      </div>
    ) : null,
}));

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/app/actions/pipeline/preview-job-pipeline-switch", () => ({ previewJobPipelineSwitchAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/set-job-pipeline", () => ({ setJobPipelineAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const JOB = "a0000000-0000-4000-8000-0000000000a1";
const DEFAULT = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e00";
const ENG = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e5f";
const SALES = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e60";
const S = (n: number) => `e5000000-0000-4000-8000-00000000000${n}`;

const row = (id: string, name: string, overrides: Partial<SwitchPreviewRow> = {}): SwitchPreviewRow => ({
  stage: { id, name, kind: "screening", archived: false },
  status: "reviewed",
  applications: 2,
  planItems: 0,
  inUse: true,
  options: [
    { id: S(1), name: "Phone screen", kind: "screening" },
    { id: S(2), name: "Tech interview", kind: "interview" },
  ],
  defaultTargetId: S(1),
  ...overrides,
});

const previewOf = (overrides: Partial<JobPipelineSwitchPreview> = {}): JobPipelineSwitchPreview => ({
  ok: true,
  job: { id: JOB, title: "Backend" },
  from: { id: DEFAULT, name: "Default" },
  to: { id: ENG, name: "Engineering" },
  same: false,
  rows: [
    row("screen", "Screen", { planItems: 1 }),
    row("applied", "Applied", {
      stage: { id: "applied", name: "Applied", kind: "applied", archived: false },
      status: "submitted",
      options: [{ id: S(3), name: "New", kind: "applied" }],
      defaultTargetId: S(3),
    }),
    row("offer", "Offer", { inUse: false, applications: 0 }),
  ],
  mapping: { screen: S(1), applied: S(3) },
  missing: [],
  ...overrides,
});

const renderForm = (initialTargetId: string | null = null) =>
  render(
    <PipelineSwitchForm
      jobPostId={JOB}
      current={{ id: DEFAULT, name: "Default" }}
      pipelines={[
        { id: ENG, name: "Engineering" },
        { id: SALES, name: "Sales" },
      ]}
      initialTargetId={initialTargetId}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewJobPipelineSwitchAction).mockResolvedValue(previewOf());
  vi.mocked(setJobPipelineAction).mockResolvedValue(undefined);
});

describe("PipelineSwitchForm (JPT-036, JP-TEST-005)", () => {
  it("starts with no target and Save off, and says nobody is emailed", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Switch pipeline" })).toBeDisabled();
    expect(screen.getByText(new RegExp(NO_EMAIL_NOTE))).toBeInTheDocument();
    expect(previewJobPipelineSwitchAction).not.toHaveBeenCalled();
  });

  it("loads the preview for the picked pipeline and shows each stage in use with its options", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("New pipeline"), { target: { value: ENG } });

    const mapping = await screen.findByRole("list", { name: "Stage mapping" });
    expect(previewJobPipelineSwitchAction).toHaveBeenCalledWith({ jobPostId: JOB, pipelineId: ENG });
    expect(within(mapping).getAllByRole("listitem")).toHaveLength(2);
    expect(within(mapping).getByText(/2 candidates · 1 interview plan item/)).toBeInTheDocument();

    // Each row offers only the stages with its candidate status, defaulted.
    const screen1 = screen.getByLabelText("New stage for Screen") as HTMLSelectElement;
    expect(screen1.value).toBe(S(1));
    expect([...screen1.options].map((o) => o.textContent).filter(Boolean)).toEqual(["Phone screen", "Tech interview"]);
    const applied = screen.getByLabelText("New stage for Applied") as HTMLSelectElement;
    expect([...applied.options].map((o) => o.textContent).filter(Boolean)).toEqual(["New"]);

    expect(screen.getByText(/Empty stages with nothing to move: Offer\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch pipeline" })).toBeEnabled();
  });

  it("preselects ?to= and loads its preview straight away", async () => {
    renderForm(ENG);
    expect(await screen.findByRole("list", { name: "Stage mapping" })).toBeInTheDocument();
    expect((screen.getByLabelText("New pipeline") as HTMLSelectElement).value).toBe(ENG);
  });

  it("saves the mapping the user picked (the action redirects to the Pipeline section)", async () => {
    // On a redirect, Next navigates and then rejects the action's promise with the redirect.
    vi.mocked(setJobPipelineAction).mockRejectedValue(
      getRedirectError(`/company/job-posts/${JOB}/pipeline`, RedirectType.push),
    );
    renderForm(ENG);
    await screen.findByRole("list", { name: "Stage mapping" });
    fireEvent.change(screen.getByLabelText("New stage for Screen"), { target: { value: S(2) } });
    fireEvent.click(screen.getByRole("button", { name: "Switch pipeline" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("This job now uses Engineering."));
    expect(screen.queryByText("Couldn't switch the job's pipeline.")).not.toBeInTheDocument();
    expect(setJobPipelineAction).toHaveBeenCalledWith({
      jobPostId: JOB,
      pipelineId: ENG,
      mapping: { screen: S(2), applied: S(3) },
    });
  });

  it("blocks Save and names the stage when the new pipeline lacks a status", async () => {
    vi.mocked(previewJobPipelineSwitchAction).mockResolvedValue(
      previewOf({
        rows: [
          row("hold", "On hold", {
            stage: { id: "hold", name: "On hold", kind: "on_hold", archived: false },
            status: "stand_by",
            options: [],
            defaultTargetId: null,
          }),
        ],
        mapping: {},
        missing: [{ stage: { id: "hold", name: "On hold", kind: "on_hold" }, status: "stand_by" }],
      }),
    );
    renderForm(ENG);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no stage that shows candidates "On hold", which "On hold" needs/);
    expect(within(alert).getByRole("link", { name: "Edit Engineering" })).toHaveAttribute(
      "href",
      `/company/settings/pipelines/${ENG}`,
    );
    expect(screen.getByRole("button", { name: "Switch pipeline" })).toBeDisabled();
  });

  it("shows a refused save and stays on the page", async () => {
    vi.mocked(setJobPipelineAction).mockResolvedValue({ ok: false, error: "Your role can't edit this job." });
    renderForm(ENG);
    await screen.findByRole("list", { name: "Stage mapping" });
    fireEvent.click(screen.getByRole("button", { name: "Switch pipeline" }));

    expect(await screen.findByText("Your role can't edit this job.")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Switch pipeline" })).toBeEnabled();
  });

  it("shows an error when the action throws something other than a redirect", async () => {
    vi.mocked(setJobPipelineAction).mockRejectedValue(new Error("network"));
    renderForm(ENG);
    await screen.findByRole("list", { name: "Stage mapping" });
    fireEvent.click(screen.getByRole("button", { name: "Switch pipeline" }));

    expect(await screen.findByText("Couldn't switch the job's pipeline.")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a failed preview", async () => {
    vi.mocked(previewJobPipelineSwitchAction).mockResolvedValue({ ok: false, error: "Pipeline not found." });
    renderForm(SALES);
    expect(await screen.findByText("Pipeline not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch pipeline" })).toBeDisabled();
  });
});

describe("PipelineSwitchForm's New pipeline… item", () => {
  const NEW: NewPipelineOption = {
    sources: [{ id: DEFAULT, name: "Default", isDefault: true }],
    atLimit: false,
    canUseAgent: false,
  };
  const renderWith = (newPipeline?: NewPipelineOption, pipelines = [{ id: ENG, name: "Engineering" }]) =>
    render(
      <PipelineSwitchForm
        jobPostId={JOB}
        current={{ id: DEFAULT, name: "Default" }}
        pipelines={pipelines}
        initialTargetId={null}
        newPipeline={newPipeline}
      />,
    );
  const newItem = () => screen.queryByRole("option", { name: /New pipeline…/ });

  it("isn't offered without settings.stages", () => {
    renderWith();
    expect(newItem()).not.toBeInTheDocument();
  });

  it("opens the dialog for this job, copying its pipeline, without picking a target", () => {
    renderWith(NEW);
    fireEvent.change(screen.getByLabelText("New pipeline"), { target: { value: NEW_PIPELINE_VALUE } });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-job", JOB);
    expect(dialog).toHaveAttribute("data-source", DEFAULT);
    expect(previewJobPipelineSwitchAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New pipeline")).toHaveValue("");
  });

  it("is the only choice when there's no other pipeline", () => {
    renderWith(NEW, []);
    expect(screen.getByLabelText("New pipeline")).toBeEnabled();
    expect(newItem()).toBeInTheDocument();
  });

  it("is disabled at the limit", () => {
    renderWith({ ...NEW, atLimit: true });
    expect(newItem()).toBeDisabled();
  });
});
