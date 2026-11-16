import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createPipelineAction } from "@/app/actions/pipeline/create-pipeline";
import NewPipelineDialog, { newPipelinePrompt } from "./NewPipelineDialog";

vi.mock("@/app/actions/pipeline/create-pipeline", () => ({ createPipelineAction: vi.fn() }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
const push = vi.fn();
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push, refresh: vi.fn() }) }));

const DEFAULT = { id: "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e00", name: "Default", isDefault: true };
const SALES = { id: "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e01", name: "Sales", isDefault: false };
const CREATED = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4eff";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPipelineAction).mockResolvedValue({ ok: true, pipelineId: CREATED });
});

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));
  return screen.findByRole("dialog");
}

describe("NewPipelineDialog's agent handoff (JPT-041)", () => {
  it("is offered only with agent.use, and hands the description to the agent", async () => {
    const { unmount } = render(<NewPipelineDialog atLimit={false} sources={[DEFAULT]} />);
    expect(within(await open()).queryByRole("form", { name: "Or describe the pipeline" })).not.toBeInTheDocument();
    unmount();

    render(<NewPipelineDialog atLimit={false} sources={[DEFAULT]} canUseAgent />);
    expect(within(await open()).getByRole("form", { name: "Or describe the pipeline" })).toBeInTheDocument();
  });

  it("asks the agent to copy the closest pipeline and show the stages before changing them", () => {
    expect(newPipelinePrompt("  Sales: phone screen, role play ")).toBe(
      "Create a new pipeline: Sales: phone screen, role play. Copy the closest of my pipelines, then set up its stages and show me before changing them.",
    );
  });
});

describe("NewPipelineDialog (JPT-032, JP-REQ-005)", () => {
  it("copies the default pipeline unless another is picked, then opens the new one's editor", async () => {
    render(<NewPipelineDialog atLimit={false} sources={[SALES, DEFAULT]} />);
    const dialog = await open();

    expect(within(dialog).getByLabelText("Copy stages from")).toHaveValue(DEFAULT.id);
    expect(within(dialog).getByRole("button", { name: "Create pipeline" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Engineering " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(createPipelineAction).toHaveBeenCalledWith({ name: "Engineering", fromPipelineId: DEFAULT.id }),
    );
    expect(push).toHaveBeenCalledWith(`/company/settings/pipelines/${CREATED}`);
  });

  it("sends the picked source", async () => {
    render(<NewPipelineDialog atLimit={false} sources={[DEFAULT, SALES]} />);
    const dialog = await open();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Sales EU" } });
    fireEvent.change(within(dialog).getByLabelText("Copy stages from"), { target: { value: SALES.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(createPipelineAction).toHaveBeenCalledWith({ name: "Sales EU", fromPipelineId: SALES.id }),
    );
  });

  it("shows a refusal and stays open", async () => {
    vi.mocked(createPipelineAction).mockResolvedValue({ ok: false, error: "Another pipeline already has that name." });
    render(<NewPipelineDialog atLimit={false} sources={[DEFAULT]} />);
    const dialog = await open();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Default" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pipeline" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Another pipeline already has that name.");
    expect(push).not.toHaveBeenCalled();
  });

  it("on a job's switch page, copies the job's pipeline and returns there with the new one picked", async () => {
    const JOB = "a0000000-0000-4000-8000-0000000000a1";
    render(<NewPipelineDialog atLimit={false} sources={[DEFAULT, SALES]} forJobId={JOB} initialSourceId={SALES.id} />);
    const dialog = await open();

    expect(within(dialog).getByLabelText("Copy stages from")).toHaveValue(SALES.id);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Sales EU" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/company/job-posts/${JOB}/pipeline/switch?to=${CREATED}`),
    );
    expect(createPipelineAction).toHaveBeenCalledWith({ name: "Sales EU", fromPipelineId: SALES.id });
  });

  it("is disabled at the limit", () => {
    render(<NewPipelineDialog atLimit sources={[DEFAULT]} />);
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeDisabled();
  });
});
