import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import { DEFAULT_STAGES, stageOf } from "@/test/utils/pipeline";
import StagePicker from "./StagePicker";

vi.mock("@/app/actions/pipeline/move-applications", () => ({
  moveApplicationsAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// MoveDialog has its own tests; here it confirms, with or without an email.
const EMAIL = { templateId: "ab000000-0000-4000-8000-0000000000e1" };
vi.mock("./MoveDialog", () => ({
  default: ({
    open,
    stage,
    previewApplicationId,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    stage: { name: string } | null;
    previewApplicationId: string | null;
    onConfirm: (email?: typeof EMAIL) => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={`Move to ${stage?.name}`} data-preview={previewApplicationId}>
        <button onClick={() => onConfirm()}>Move</button>
        <button onClick={() => onConfirm(EMAIL)}>Move and email</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

// Radix Select doesn't run in jsdom; a native <select> keeps the same contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      aria-label="Stage"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const APPLICATION_ID = "ab000000-0000-4000-8000-000000000001";
const STAGES = DEFAULT_STAGES.map(({ id, name, kind }) => ({ id, name, kind }));

const select = () => screen.getByRole("combobox", { name: "Stage" });
const renderPicker = (current = stageOf("screening").id) =>
  render(<StagePicker applicationId={APPLICATION_ID} stages={STAGES} currentStageId={current} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: true, moved: 1, emailed: 0, skipped: [] });
});

describe("StagePicker (PLT-032)", () => {
  it("lists the active stages in order and shows the current one", () => {
    renderPicker();

    const options = within(select()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(STAGES.map((s) => s.name));
    expect(select()).toHaveValue(stageOf("screening").id);
  });

  it("moves at once when the candidate-facing status doesn't change", async () => {
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("interview").id } });

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(moveApplicationsAction).toHaveBeenCalledWith({
      applicationIds: [APPLICATION_ID],
      stageId: stageOf("interview").id,
    });
    expect(select()).toHaveValue(stageOf("interview").id);
    expect(refresh).toHaveBeenCalled();
  });

  it("opens MoveDialog first when the candidate will see a new status", async () => {
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("rejected").id } });

    const dialog = screen.getByRole("dialog", { name: `Move to ${stageOf("rejected").name}` });
    expect(dialog).toHaveAttribute("data-preview", APPLICATION_ID);
    expect(moveApplicationsAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: [APPLICATION_ID],
        stageId: stageOf("rejected").id,
      }),
    );
  });

  it("passes the email from MoveDialog to the move", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: true, moved: 1, emailed: 1, skipped: [] });
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("rejected").id } });
    fireEvent.click(screen.getByRole("button", { name: "Move and email" }));

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: [APPLICATION_ID],
        stageId: stageOf("rejected").id,
        email: EMAIL,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("The email is on its way"));
  });

  it("keeps the move but says so when the email fails", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({
      ok: true,
      moved: 1,
      emailed: 0,
      skipped: [{ id: APPLICATION_ID, reason: "email_failed" }],
    });
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("rejected").id } });
    fireEvent.click(screen.getByRole("button", { name: "Move and email" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("email couldn't be sent")));
    expect(select()).toHaveValue(stageOf("rejected").id);
  });

  it("cancelling the confirmation keeps the current stage", () => {
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("hired").id } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(moveApplicationsAction).not.toHaveBeenCalled();
    expect(select()).toHaveValue(stageOf("screening").id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reverts and toasts when the action refuses", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: false, error: "Stage not found." });
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("interview").id } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stage not found."));
    expect(select()).toHaveValue(stageOf("screening").id);
  });

  it("reverts and toasts when nothing was moved", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({
      ok: true,
      moved: 0,
      emailed: 0,
      skipped: [{ id: APPLICATION_ID, reason: "not_found" }],
    });
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("interview").id } });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(select()).toHaveValue(stageOf("screening").id);
  });

  it("reverts and toasts when the request fails", async () => {
    vi.mocked(moveApplicationsAction).mockRejectedValue(new Error("network"));
    renderPicker();

    fireEvent.change(select(), { target: { value: stageOf("interview").id } });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(select()).toHaveValue(stageOf("screening").id);
  });
});
