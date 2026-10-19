import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import posthog from "posthog-js";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import { DEFAULT_STAGES, PIPELINE_JOB, stageOf } from "@/test/utils/pipeline";
import type { BoardApplication, PipelineBoardData } from "@/utils/types/pipeline.types";
import PipelineBoard from "./PipelineBoard";

vi.mock("@/app/actions/pipeline/move-applications", () => ({
  moveApplicationsAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// MoveDialog grows its email options in PLT-063; here it only confirms.
vi.mock("./MoveDialog", () => ({
  default: ({
    open,
    stage,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    stage: { name: string } | null;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={`Move to ${stage?.name}`}>
        <button onClick={() => onConfirm()}>Confirm move</button>
        <button onClick={onCancel}>Cancel move</button>
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
const appId = (n: number) => `ab000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const cardOf = (n: number, overrides: Partial<BoardApplication> = {}): BoardApplication => ({
  id: appId(n),
  stageId: stageOf("applied").id,
  name: `Candidate ${n}`,
  fitScore: null,
  daysInStage: 0,
  noteCount: 0,
  ratingAvg: null,
  ...overrides,
});

const boardOf = (applications: BoardApplication[], extra: Partial<PipelineBoardData> = {}) => ({
  stages: STAGES,
  applications,
  ...extra,
});

const column = (name: string) => screen.getByRole("region", { name });
const handle = (name: string) => screen.getByRole("button", { name: `Move ${name}` });

function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop && query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// jsdom has no layout. Columns sit side by side, 300px apart, and each card
// sits near the top of its column, so dnd-kit's keyboard coordinates work.
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
const realRect = Element.prototype.getBoundingClientRect;
function layOutColumns() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const col = this.closest<HTMLElement>("[data-stage-index]");
    if (!col) return rect(0, 0, 0, 0);
    const left = Number(col.dataset.stageIndex) * 300;
    return this === col ? rect(left, 0, 280, 200) : rect(left + 10, 60, 260, 80);
  };
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Focus a card's handle, Space, ArrowRight, Space. */
async function keyboardMoveRight(name: string) {
  const el = handle(name);
  el.focus();
  fireEvent.keyDown(el, { code: "Space", key: " " });
  await tick();
  fireEvent.keyDown(el, { code: "ArrowRight", key: "ArrowRight" });
  await tick();
  fireEvent.keyDown(el, { code: "Space", key: " " });
  await tick();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  setViewport(true);
  layOutColumns();
  vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: true, moved: 1, emailed: 0, skipped: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
  );
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  vi.unstubAllGlobals();
});

describe("PipelineBoard (PLT-043, PL-TEST-006)", () => {
  it("renders one column per active stage, in order, with a count", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1), cardOf(2), cardOf(3, { stageId: stageOf("interview").id })])}
      />,
    );

    const columns = screen.getAllByRole("region");
    expect(columns.map((c) => c.getAttribute("aria-label"))).toEqual(STAGES.map((s) => s.name));
    expect(within(column("Applied")).getByText("2")).toBeInTheDocument();
    expect(within(column("Interview")).getByText("1")).toBeInTheDocument();
    expect(within(column("Offer")).getByText("0")).toBeInTheDocument();
  });

  it("shows the name, the fit score or –, days in stage and note count on a card", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([
          cardOf(1, { name: "Priya Sharma", fitScore: 82, daysInStage: 3, noteCount: 2, ratingAvg: 3.5 }),
          cardOf(2, { name: "Arjun Rao" }),
        ])}
      />,
    );

    const priya = screen.getByRole("link", { name: "Priya Sharma" });
    expect(priya).toHaveAttribute("href", `/company/applications/${appId(1)}`);
    const card = priya.closest("[data-card]") as HTMLElement;
    expect(within(card).getByText("82")).toBeInTheDocument();
    expect(within(card).getByText("3d in stage")).toBeInTheDocument();
    expect(within(card).getByText("2 notes")).toBeInTheDocument();
    expect(within(card).getByTitle("Average rating")).toHaveTextContent("3.5");

    const arjun = screen.getByRole("link", { name: "Arjun Rao" }).closest("[data-card]") as HTMLElement;
    expect(within(arjun).getByText("–")).toBeInTheDocument();
    expect(within(arjun).queryByTitle("Average rating")).not.toBeInTheDocument();
  });

  it("badges a card that failed a knockout rule (AF-REQ-003)", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Kai", knockoutReasons: ["Can you relocate?"] }), cardOf(2, { name: "Lee" })])}
      />,
    );
    const kai = screen.getByRole("link", { name: "Kai" }).closest("[data-card]") as HTMLElement;
    expect(within(kai).getByTitle("Didn't meet: Can you relocate?")).toBeInTheDocument();
    const lee = screen.getByRole("link", { name: "Lee" }).closest("[data-card]") as HTMLElement;
    expect(within(lee).queryByText("Didn't meet requirements")).not.toBeInTheDocument();
  });

  it("badges a card with its AI interview (SIT-062)", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([
          cardOf(1, { name: "Kai", interview: { id: "ai1", status: "completed", overallScore: 4.5, report: "ready" } }),
          cardOf(2, { name: "Lee" }),
        ])}
      />,
    );
    const kai = screen.getByRole("link", { name: "Kai" }).closest("[data-card]") as HTMLElement;
    expect(within(kai).getByTitle("AI interview")).toHaveTextContent("4.5 / 5");
    const lee = screen.getByRole("link", { name: "Lee" }).closest("[data-card]") as HTMLElement;
    expect(within(lee).queryByTitle("AI interview")).not.toBeInTheDocument();
  });

  it("captures pipeline_board_viewed once", () => {
    render(<PipelineBoard jobPostId={PIPELINE_JOB.id} initial={boardOf([])} />);

    expect(posthog.capture).toHaveBeenCalledWith("pipeline_board_viewed", { applications: 0 });
  });

  it("moves a card to the next stage by keyboard, optimistically", async () => {
    const pending = deferred<{ ok: true; moved: number; emailed: number; skipped: [] }>();
    vi.mocked(moveApplicationsAction).mockReturnValue(pending.promise);
    // Screening -> Interview keeps the candidate-facing status (reviewed).
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma", stageId: stageOf("screening").id })])}
      />,
    );

    await keyboardMoveRight("Priya Sharma");

    expect(moveApplicationsAction).toHaveBeenCalledWith({
      applicationIds: [appId(1)],
      stageId: stageOf("interview").id,
    });
    // Moved before the action answers.
    expect(within(column("Interview")).getByText("Priya Sharma")).toBeInTheDocument();
    expect(within(column("Screening")).queryByText("Priya Sharma")).not.toBeInTheDocument();

    pending.resolve({ ok: true, moved: 1, emailed: 0, skipped: [] });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/company/job-posts/${PIPELINE_JOB.id}/pipeline`));
    expect(screen.getByRole("status")).toHaveTextContent(/Interview/);
  });

  it("moves the card back and toasts when the action fails", async () => {
    vi.mocked(moveApplicationsAction).mockResolvedValue({ ok: false, error: "Stage not found." });
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma", stageId: stageOf("screening").id })])}
      />,
    );

    await keyboardMoveRight("Priya Sharma");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stage not found."));
    expect(within(column("Screening")).getByText("Priya Sharma")).toBeInTheDocument();
    expect(within(column("Interview")).queryByText("Priya Sharma")).not.toBeInTheDocument();
  });

  it("opens MoveDialog instead of moving when the candidate-facing status changes", async () => {
    // Applied (submitted) -> Screening (reviewed).
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma" })])}
      />,
    );

    await keyboardMoveRight("Priya Sharma");

    expect(screen.getByRole("dialog", { name: "Move to Screening" })).toBeInTheDocument();
    expect(moveApplicationsAction).not.toHaveBeenCalled();
    expect(within(column("Applied")).getByText("Priya Sharma")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: [appId(1)],
        stageId: stageOf("screening").id,
      }),
    );
    expect(within(column("Screening")).getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("leaves the card where it was when MoveDialog is cancelled", async () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma" })])}
      />,
    );

    await keyboardMoveRight("Priya Sharma");
    fireEvent.click(screen.getByRole("button", { name: "Cancel move" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(moveApplicationsAction).not.toHaveBeenCalled();
    expect(within(column("Applied")).getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("links a truncated column to the list view", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1)], { truncated: { [stageOf("applied").id]: 640 } })}
      />,
    );

    const applied = column("Applied");
    expect(within(applied).getByText("640")).toBeInTheDocument();
    expect(within(applied).getByRole("link", { name: "Show all in list view" })).toHaveAttribute(
      "href",
      "?view=list",
    );
    expect(within(column("Screening")).queryByText("Show all in list view")).not.toBeInTheDocument();
  });
});

describe("PipelineBoard below md (PLT-045)", () => {
  beforeEach(() => setViewport(false));

  it("shows a stage picker and a single list of that stage's cards", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([
          cardOf(1, { name: "Priya Sharma" }),
          cardOf(2, { name: "Arjun Rao", stageId: stageOf("interview").id }),
        ])}
      />,
    );

    expect(screen.queryAllByRole("region")).toHaveLength(0);
    const picker = screen.getByRole("combobox", { name: "Stage" });
    expect(picker).toHaveValue(stageOf("applied").id);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.queryByText("Arjun Rao")).not.toBeInTheDocument();

    fireEvent.change(picker, { target: { value: stageOf("interview").id } });

    expect(screen.getByText("Arjun Rao")).toBeInTheDocument();
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
  });

  it("moves a card from its Move to… menu", async () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma", stageId: stageOf("screening").id })])}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Stage" }), {
      target: { value: stageOf("screening").id },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Move Priya Sharma to…" }), {
      target: { value: stageOf("offer").id },
    });

    await waitFor(() =>
      expect(moveApplicationsAction).toHaveBeenCalledWith({
        applicationIds: [appId(1)],
        stageId: stageOf("offer").id,
      }),
    );
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
  });

  it("opens MoveDialog from the menu when the status changes", () => {
    render(
      <PipelineBoard
        jobPostId={PIPELINE_JOB.id}
        initial={boardOf([cardOf(1, { name: "Priya Sharma" })])}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Move Priya Sharma to…" }), {
      target: { value: stageOf("rejected").id },
    });

    expect(screen.getByRole("dialog", { name: "Move to Rejected" })).toBeInTheDocument();
    expect(moveApplicationsAction).not.toHaveBeenCalled();
  });
});
