import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { saveStagesAction } from "@/app/actions/pipeline/save-stages";
import { DEFAULT_STAGES, stageOf } from "@/test/utils/pipeline";
import StageEditor from "./StageEditor";

vi.mock("@/app/actions/pipeline/save-stages", () => ({ saveStagesAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; children?: ReactNode }) => null = () => null;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: ReactNode;
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement(child) && child.type === SelectTrigger,
      ) as { props: { "aria-label"?: string } } | undefined;
      return (
        <select
          aria-label={trigger?.props["aria-label"]}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
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
const rows = () => screen.getAllByRole("listitem");
const rowOf = (name: string) =>
  rows().find((li) => within(li).queryByDisplayValue(name)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveStagesAction).mockResolvedValue({ ok: true });
});

describe("StageEditor (PLT-064)", () => {
  it("lists the stages in order, with archive only on the stages that allow it", () => {
    render(<StageEditor stages={STAGES} />);

    expect(rows().map((li) => (within(li).getByRole("textbox") as HTMLInputElement).value)).toEqual(
      STAGES.map((s) => s.name),
    );
    expect(within(rowOf("Applied")).queryByRole("button", { name: "Archive Applied" })).toBeNull();
    expect(within(rowOf("Hired")).queryByRole("button", { name: "Archive Hired" })).toBeNull();
    expect(within(rowOf("Rejected")).queryByRole("button", { name: "Archive Rejected" })).toBeNull();
    expect(within(rowOf("Interview")).getByRole("button", { name: "Archive Interview" })).toBeInTheDocument();
  });

  it("renames a stage when its name field loses focus", async () => {
    render(<StageEditor stages={STAGES} />);

    const input = screen.getByRole("textbox", { name: "Name of Interview" });
    fireEvent.change(input, { target: { value: "Onsite" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(saveStagesAction).toHaveBeenCalledWith({
        op: "rename",
        stageId: stageOf("interview").id,
        name: "Onsite",
      }),
    );
  });

  it("reorders with the up and down buttons", async () => {
    render(<StageEditor stages={STAGES} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Interview up" }));

    const order = [...STAGES];
    [order[1], order[2]] = [order[2], order[1]];
    await waitFor(() =>
      expect(saveStagesAction).toHaveBeenCalledWith({ op: "reorder", ids: order.map((s) => s.id) }),
    );
    expect(rows().map((li) => (within(li).getByRole("textbox") as HTMLInputElement).value)[1]).toBe("Interview");
    expect(screen.getByRole("button", { name: "Move Applied up" })).toBeDisabled();
  });

  it("puts the order back when the reorder fails", async () => {
    vi.mocked(saveStagesAction).mockResolvedValue({ ok: false, error: "Failed to reorder the stages." });
    render(<StageEditor stages={STAGES} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Interview up" }));

    await waitFor(() =>
      expect(rows().map((li) => (within(li).getByRole("textbox") as HTMLInputElement).value)[2]).toBe(
        "Interview",
      ),
    );
  });

  it("shows an archive refusal inline", async () => {
    vi.mocked(saveStagesAction).mockResolvedValue({
      ok: false,
      error: "Move the 3 applications out of this stage first.",
      count: 3,
    });
    render(<StageEditor stages={STAGES} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive Interview" }));

    expect(await within(rowOf("Interview")).findByRole("alert")).toHaveTextContent(
      "Move the 3 applications out of this stage first.",
    );
    expect(rowOf("Interview")).toBeInTheDocument();
  });

  it("removes an archived stage", async () => {
    render(<StageEditor stages={STAGES} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive Interview" }));

    await waitFor(() => expect(screen.queryByDisplayValue("Interview")).not.toBeInTheDocument());
    expect(saveStagesAction).toHaveBeenCalledWith({ op: "archive", stageId: stageOf("interview").id });
  });

  it("adds a stage with a kind", async () => {
    const added = { ...stageOf("interview"), id: "5a000000-0000-4000-8000-0000000000ff", name: "Take-home", position: 7 };
    vi.mocked(saveStagesAction).mockResolvedValue({ ok: true, stage: added });
    render(<StageEditor stages={STAGES} />);

    fireEvent.change(screen.getByRole("textbox", { name: "New stage name" }), { target: { value: "Take-home" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "interview" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));

    await waitFor(() => expect(screen.getByDisplayValue("Take-home")).toBeInTheDocument());
    expect(saveStagesAction).toHaveBeenCalledWith({ op: "create", name: "Take-home", kind: "interview" });
    expect(screen.getByRole("textbox", { name: "New stage name" })).toHaveValue("");
  });

  it("stops adding at 12 stages", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      id: `5a000000-0000-4000-8000-0000000001${i.toString().padStart(2, "0")}`,
      name: `Stage ${i}`,
      kind: "screening" as const,
    }));
    render(<StageEditor stages={twelve} />);

    expect(screen.getByRole("button", { name: "Add stage" })).toBeDisabled();
    expect(screen.getByText("A pipeline can have at most 12 stages.")).toBeInTheDocument();
  });
});
