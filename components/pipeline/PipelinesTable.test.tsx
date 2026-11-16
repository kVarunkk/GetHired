import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { archivePipelineAction } from "@/app/actions/pipeline/archive-pipeline";
import { renamePipelineAction } from "@/app/actions/pipeline/rename-pipeline";
import { setDefaultPipelineAction } from "@/app/actions/pipeline/set-default-pipeline";
import { pipelineReasonCopy } from "@/helpers/pipeline/copy";
import PipelinesTable, { archiveBlockedReason, type PipelineRow } from "./PipelinesTable";

vi.mock("@/app/actions/pipeline/archive-pipeline", () => ({ archivePipelineAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/rename-pipeline", () => ({ renamePipelineAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/set-default-pipeline", () => ({ setDefaultPipelineAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push: vi.fn(), refresh }) }));

const DEFAULT: PipelineRow = { id: "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e00", name: "Default", isDefault: true, jobs: 3, activeStages: 7 };
const SALES: PipelineRow = { id: "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e01", name: "Sales", isDefault: false, jobs: 1, activeStages: 6 };
const UNUSED: PipelineRow = { id: "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e02", name: "Unused", isDefault: false, jobs: 0, activeStages: 7 };

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  return screen.findByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(archivePipelineAction).mockResolvedValue({ ok: true });
  vi.mocked(renamePipelineAction).mockResolvedValue({ ok: true });
  vi.mocked(setDefaultPipelineAction).mockResolvedValue({ ok: true });
});

describe("archiveBlockedReason (JP-REQ-008)", () => {
  it("refuses the default and a pipeline any job uses, with the RPC's copy", () => {
    expect(archiveBlockedReason(DEFAULT)).toBe(pipelineReasonCopy("is_default"));
    expect(archiveBlockedReason(SALES)).toBe(pipelineReasonCopy("in_use", { jobs: 1 }));
    expect(archiveBlockedReason(UNUSED)).toBeNull();
  });
});

describe("PipelinesTable (JPT-032)", () => {
  it("disables Archive, with the reason, for the default and in-use pipelines", async () => {
    render(<PipelinesTable canManage pipelines={[DEFAULT, SALES, UNUSED]} />);

    const defaultMenu = await openMenu("Default");
    const archiveDefault = within(defaultMenu).getByRole("menuitem", { name: "Archive" });
    expect(archiveDefault).toHaveAttribute("data-disabled");
    expect(archiveDefault).toHaveAttribute("title", pipelineReasonCopy("is_default"));
    expect(within(defaultMenu).queryByRole("menuitem", { name: "Make default" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const salesMenu = await openMenu("Sales");
    expect(within(salesMenu).getByRole("menuitem", { name: "Archive" })).toHaveAttribute("data-disabled");
    await userEvent.keyboard("{Escape}");

    const unusedMenu = await openMenu("Unused");
    expect(within(unusedMenu).getByRole("menuitem", { name: "Archive" })).not.toHaveAttribute("data-disabled");
  });

  it("archives an unused pipeline after confirming", async () => {
    render(<PipelinesTable canManage pipelines={[DEFAULT, UNUSED]} />);

    await userEvent.click(within(await openMenu("Unused")).getByRole("menuitem", { name: "Archive" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(archivePipelineAction).toHaveBeenCalledWith({ pipelineId: UNUSED.id }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("makes a pipeline the default", async () => {
    render(<PipelinesTable canManage pipelines={[DEFAULT, SALES]} />);

    await userEvent.click(within(await openMenu("Sales")).getByRole("menuitem", { name: "Make default" }));

    await waitFor(() => expect(setDefaultPipelineAction).toHaveBeenCalledWith({ pipelineId: SALES.id }));
  });

  it("renames from a dialog and shows a refusal inline", async () => {
    vi.mocked(renamePipelineAction).mockResolvedValueOnce({ ok: false, error: "Another pipeline already has that name." });
    render(<PipelinesTable canManage pipelines={[DEFAULT, SALES]} />);

    await userEvent.click(within(await openMenu("Sales")).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Name");
    expect(input).toHaveValue("Sales");
    fireEvent.change(input, { target: { value: "  Default  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Another pipeline already has that name.");
    expect(renamePipelineAction).toHaveBeenCalledWith({ pipelineId: SALES.id, name: "Default" });

    fireEvent.change(input, { target: { value: "Sales and BD" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("has no row actions without settings.stages", () => {
    render(<PipelinesTable canManage={false} pipelines={[DEFAULT, SALES]} />);

    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View" })[0]).toHaveAttribute(
      "href",
      `/company/settings/pipelines/${DEFAULT.id}`,
    );
  });
});
