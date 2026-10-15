import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import { DEFAULT_STAGES, stageOf } from "@/test/utils/pipeline";
import BulkActionBar from "./BulkActionBar";

vi.mock("@/app/actions/pipeline/move-applications", () => ({
  moveApplicationsAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// MoveDialog has its own tests; here it reports what it was opened with.
vi.mock("./MoveDialog", () => ({
  default: ({
    open,
    stage,
    changesStatus,
    previewApplicationId,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    stage: { name: string } | null;
    changesStatus: boolean;
    previewApplicationId: string | null;
    onConfirm: (email?: { templateId: string }) => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label={`Move to ${stage?.name}`}
        data-changes-status={String(changesStatus)}
        data-preview={previewApplicationId ?? ""}
      >
        <button onClick={() => onConfirm()}>Move</button>
        <button onClick={() => onConfirm({ templateId: "7e700000-0000-4000-8000-000000000001" })}>
          Move and email
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; children?: ReactNode }) => null = () => null;
  return {
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
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement(child) && child.type === SelectTrigger,
      ) as { props: { "aria-label"?: string } } | undefined;
      return (
        <select
          aria-label={trigger?.props["aria-label"]}
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
        >
          <option value="" />
          {children}
        </select>
      );
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const STAGES = DEFAULT_STAGES.map(({ id, name, kind }) => ({ id, name, kind }));
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `ab000000-0000-4000-8000-${(i + 1).toString().padStart(12, "0")}`);

const moveTo = () => screen.getByRole("combobox", { name: "Move to…" });
const reject = () => screen.getByRole("button", { name: "Reject…" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: true, moved: 2, emailed: 0, skipped: [] });
});

describe("BulkActionBar (PL-TEST-006)", () => {
  it("is hidden with nothing selected", () => {
    const { container } = render(<BulkActionBar selectedIds={[]} stages={STAGES} onDone={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("moves the selection after confirming, then clears it", async () => {
    const onDone = vi.fn();
    render(<BulkActionBar selectedIds={ids(2)} stages={STAGES} onDone={onDone} />);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.change(moveTo(), { target: { value: stageOf("interview").id } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(moveApplicationsAction).toHaveBeenCalledWith({
      applicationIds: ids(2),
      stageId: stageOf("interview").id,
    });
    expect(toast.success).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("Reject… picks the company's Rejected stage", async () => {
    render(<BulkActionBar selectedIds={ids(3)} stages={STAGES} onDone={vi.fn()} />);

    fireEvent.click(reject());
    expect(screen.getByRole("dialog", { name: "Move to Rejected" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: ids(3),
        stageId: stageOf("rejected").id,
      }),
    );
  });

  it("passes the dialog's email choice to the action and reports what was sent", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({
      ok: true,
      moved: 2,
      emailed: 1,
      skipped: [{ id: ids(2)[1], reason: "email_failed" }],
    });
    render(<BulkActionBar selectedIds={ids(2)} stages={STAGES} onDone={vi.fn()} />);

    fireEvent.click(reject());
    fireEvent.click(screen.getByRole("button", { name: "Move and email" }));

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: ids(2),
        stageId: stageOf("rejected").id,
        email: { templateId: "7e700000-0000-4000-8000-000000000001" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Moved 2 applications to Rejected. Emailed 1. 1 email couldn't be sent.",
    );
  });

  it("tells MoveDialog whether the move changes a candidate's status, and who to preview", () => {
    // Both are in Screening: Interview keeps "reviewed", Rejected doesn't.
    const stageIdOf = () => stageOf("screening").id;
    render(<BulkActionBar selectedIds={ids(2)} stages={STAGES} stageIdOf={stageIdOf} onDone={vi.fn()} />);

    fireEvent.change(moveTo(), { target: { value: stageOf("interview").id } });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-changes-status", "false");
    expect(dialog).toHaveAttribute("data-preview", ids(2)[0]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(reject());
    expect(screen.getByRole("dialog")).toHaveAttribute("data-changes-status", "true");
  });

  it("disables Move to… and Reject… while a move is pending", async () => {
    const pending = deferred<{ ok: true; moved: number; emailed: number; skipped: [] }>();
    vi.mocked(moveApplicationsAction).mockReturnValue(pending.promise);
    render(<BulkActionBar selectedIds={ids(2)} stages={STAGES} onDone={vi.fn()} />);

    fireEvent.click(reject());
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(reject()).toBeDisabled());
    expect(moveTo()).toBeDisabled();

    pending.resolve({ ok: true, moved: 2, emailed: 0, skipped: [] });
    await waitFor(() => expect(reject()).toBeEnabled());
  });

  it("shows Select up to 50 and disables the actions above 50", () => {
    render(<BulkActionBar selectedIds={ids(51)} stages={STAGES} onDone={vi.fn()} />);

    expect(screen.getByText(/Select up to 50/)).toBeInTheDocument();
    expect(reject()).toBeDisabled();
    expect(moveTo()).toBeDisabled();
  });

  it("keeps the selection and toasts when the action refuses", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: false, error: "Stage not found." });
    const onDone = vi.fn();
    render(<BulkActionBar selectedIds={ids(2)} stages={STAGES} onDone={onDone} />);

    fireEvent.click(reject());
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stage not found."));
    expect(onDone).not.toHaveBeenCalled();
  });
});
