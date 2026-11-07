import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyReviewSuggestionsAction } from "@/app/actions/resume-review/apply-suggestions";
import { loadResumeChangesAction } from "@/app/actions/resume-review/load-resume-changes";
import { undoReviewSuggestionAction } from "@/app/actions/resume-review/undo-suggestion";
import type { ReviewChange } from "@/helpers/resume-review/changes";
import type { ChangesTarget, LoadResumeChangesResult } from "@/helpers/resume-review/load-changes";
import ResumeChangesCard, { ResumeChangesResult, type ResumeChangesOutput } from "./ResumeChangesCard";

vi.mock("@/app/actions/resume-review/apply-suggestions", () => ({ applyReviewSuggestionsAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/load-resume-changes", () => ({ loadResumeChangesAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/undo-suggestion", () => ({ undoReviewSuggestionAction: vi.fn() }));

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const COPY_ID = "33333333-3333-4333-8333-333333333333";

const base = { reason: "It reads better", priority: "high" };

const REWRITE: ReviewChange = {
  ...base,
  kind: "rewrite",
  id: "b1",
  bullet_id: "b1",
  original: "Worked on billing",
  suggested: "Built the billing API",
};
const REMOVE: ReviewChange = { ...base, kind: "remove", id: "remove-1", bullet_id: "b2", original: "Helped with tests" };
const ADD: ReviewChange = {
  ...base,
  kind: "add",
  id: "add-1",
  item_id: "i1",
  anchors: ["b1"],
  suggested: "Cut costs by [X%] for [N] teams",
};
const MOVE: ReviewChange = { ...base, kind: "move", id: "move-1", target_id: "b2", index: 0 };

const target = (
  resumeId: string | null,
  states: ChangesTarget["states"],
  applied: ChangesTarget["applied"] = {},
): ChangesTarget => ({
  resumeId,
  template: "classic",
  contact: { fullName: "Ada", links: [] },
  content: {
    version: 2,
    sections: [
      {
        id: "s1",
        type: "experience",
        items: [
          {
            id: "i1",
            heading: "Engineer",
            bullets: [
              { id: "b1", text: "Worked on billing" },
              { id: "b2", text: "Helped with tests" },
            ],
          },
        ],
      },
    ],
  },
  states,
  applied,
});

const pending = (changes: ReviewChange[]) => Object.fromEntries(changes.map(({ id }) => [id, "pending" as const]));

const view = (changes: ReviewChange[], extra: Partial<Extract<LoadResumeChangesResult, { ok: true }>> = {}) =>
  ({
    ok: true,
    reviewId: REVIEW_ID,
    summary: "Too many task descriptions.",
    resumeName: "Backend",
    changes,
    gaps: [],
    original: target(SOURCE_ID, pending(changes)),
    copy: target(null, pending(changes)),
    ...extra,
  }) satisfies LoadResumeChangesResult;

const show = async (result: LoadResumeChangesResult) => {
  const onComplete = vi.fn<(output: ResumeChangesOutput) => void>();
  vi.mocked(loadResumeChangesAction).mockResolvedValue(result);
  render(<ResumeChangesCard reviewId={REVIEW_ID} onComplete={onComplete} />);
  await waitFor(() => expect(screen.queryByText("Loading the changes…")).not.toBeInTheDocument());
  return onComplete;
};

const applied = (ids: string[], targetResumeId = COPY_ID) =>
  vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({
    ok: true,
    target: "copy",
    targetResumeId,
    items: ids.map((id) => ({ id, status: "applied" as const })),
  });

const applyButton = () => screen.getByRole("button", { name: /^Apply \d+ of \d+$/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResumeChangesCard", () => {
  it("loads by id, and shows the summary and each reason (RI-REQ-023, 024)", async () => {
    await show(view([REWRITE, REMOVE]));

    expect(loadResumeChangesAction).toHaveBeenCalledWith(REVIEW_ID);
    expect(screen.getByText("Too many task descriptions.")).toBeInTheDocument();
    expect(screen.getAllByText("It reads better")).toHaveLength(2);
  });

  it("ticks every change except ones with an unfilled placeholder (RI-REQ-025)", async () => {
    await show(view([REWRITE, ADD]));

    expect(screen.getByRole("checkbox", { name: /^Rewrite/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^New bullet/ })).not.toBeChecked();
    expect(applyButton()).toHaveTextContent("Apply 1 of 2");
  });

  it("counts as the user ticks, and has Select all and Clear all", async () => {
    await show(view([REWRITE, REMOVE, MOVE]));
    expect(applyButton()).toHaveTextContent("Apply 3 of 3");

    await userEvent.click(screen.getByRole("checkbox", { name: /^Remove/ }));
    expect(applyButton()).toHaveTextContent("Apply 2 of 3");

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(applyButton()).toHaveTextContent("Apply 0 of 3");
    expect(applyButton()).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(applyButton()).toHaveTextContent("Apply 3 of 3");
  });

  it("gives each placeholder an input, and ticks the change once all are filled (RI-REQ-026)", async () => {
    await show(view([ADD]));

    await userEvent.type(screen.getByLabelText("Value for [X%]"), "30%");
    expect(screen.getByRole("checkbox", { name: /^New bullet/ })).not.toBeChecked();

    await userEvent.type(screen.getByLabelText("Value for [N]"), "4");
    expect(screen.getByRole("checkbox", { name: /^New bullet/ })).toBeChecked();
    expect(applyButton()).toBeEnabled();
  });

  it("blocks Apply on a ticked change with an empty placeholder", async () => {
    await show(view([REWRITE, ADD]));

    await userEvent.click(screen.getByRole("checkbox", { name: /^New bullet/ }));

    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/Fill in the bracketed values/)).toBeInTheDocument();
  });

  it("updates the diff as the user ticks (RI-REQ-027)", async () => {
    await show(view([REWRITE]));
    expect(screen.getByRole("button", { name: "Full view" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /^Rewrite/ }));

    expect(screen.queryByRole("button", { name: "Full view" })).not.toBeInTheDocument();
  });

  it("shows a filled value in the diff", async () => {
    const { container } = render(<div />);
    await show(view([ADD]));

    await userEvent.type(screen.getByLabelText("Value for [X%]"), "30%");
    await userEvent.type(screen.getByLabelText("Value for [N]"), "4");

    expect(container.ownerDocument.querySelector("ins")).toHaveTextContent("Cut costs by 30% for 4 teams");
  });

  it("applies to a copy by default, sending only what changed, and reports back (RI-REQ-021, 028)", async () => {
    applied(["b1", "remove-1"]);
    const onComplete = await show(view([REWRITE, REMOVE, MOVE]));

    await userEvent.click(screen.getByRole("checkbox", { name: /^Move/ }));
    await userEvent.click(applyButton());

    expect(applyReviewSuggestionsAction).toHaveBeenCalledWith(
      { reviewId: REVIEW_ID, target: "copy", items: [{ id: "b1" }, { id: "remove-1" }] },
      "agent",
    );
    expect(onComplete).toHaveBeenCalledWith({
      status: "applied",
      applied: ["b1", "remove-1"],
      skipped: ["move-1"],
      changed: [],
      targetResumeId: COPY_ID,
    });
  });

  it("sends filled and edited text", async () => {
    applied(["b1", "add-1"]);
    await show(view([REWRITE, ADD]));

    await userEvent.type(screen.getByLabelText("Value for [X%]"), "30%");
    await userEvent.type(screen.getByLabelText("Value for [N]"), "4");
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await userEvent.clear(screen.getByLabelText("Edit the wording"));
    await userEvent.type(screen.getByLabelText("Edit the wording"), "My own words");
    await userEvent.click(applyButton());

    expect(vi.mocked(applyReviewSuggestionsAction).mock.calls[0][0].items).toEqual([
      { id: "b1", text: "My own words" },
      { id: "add-1", text: "Cut costs by 30% for 4 teams" },
    ]);
  });

  it("can apply to the original, and warns what can't be undone (RI-REQ-036)", async () => {
    applied(["b1"], SOURCE_ID);
    await show(view([REWRITE]));
    expect(screen.queryByText(/Only rewrites can be undone/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "The original" }));
    expect(screen.getByText(/Only rewrites can be undone/)).toBeInTheDocument();

    await userEvent.click(applyButton());
    expect(vi.mocked(applyReviewSuggestionsAction).mock.calls[0][0].target).toBe("original");
  });

  it("reports a change the server found stale", async () => {
    vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({
      ok: true,
      target: "copy",
      targetResumeId: COPY_ID,
      items: [{ id: "b1", status: "applied" }, { id: "remove-1", status: "changed" }],
    });
    const onComplete = await show(view([REWRITE, REMOVE]));

    await userEvent.click(applyButton());

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ applied: ["b1"], changed: ["remove-1"] }));
  });

  it("stays open with the error when nothing could be applied", async () => {
    vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({
      ok: true,
      target: "copy",
      targetResumeId: null,
      items: [{ id: "b1", status: "changed" }],
    });
    const onComplete = await show(view([REWRITE]));

    await userEvent.click(applyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer fit/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("stays open with the error when the apply fails", async () => {
    vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({ ok: false, code: "INVALID", error: "Too many bullets." });
    const onComplete = await show(view([REWRITE]));

    await userEvent.click(applyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many bullets.");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reports a discard, and writes nothing", async () => {
    const onComplete = await show(view([REWRITE, REMOVE]));

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({
      status: "discarded",
      applied: [],
      skipped: ["b1", "remove-1"],
      changed: [],
      targetResumeId: null,
    });
  });

  it("leaves out what's already applied there, so a reopened card shows what's left (RI-REQ-029a)", async () => {
    await show(
      view([REWRITE, REMOVE], {
        copy: target(COPY_ID, { b1: "applied", "remove-1": "pending" }),
      }),
    );

    expect(screen.queryByRole("checkbox", { name: /^Rewrite/ })).not.toBeInTheDocument();
    expect(applyButton()).toHaveTextContent("Apply 1 of 1");
  });

  it("says how many no longer fit", async () => {
    await show(view([REWRITE, REMOVE], { copy: target(null, { b1: "changed", "remove-1": "pending" }) }));

    expect(screen.getByText(/1 change left out/)).toBeInTheDocument();
  });

  it("lists the gaps as questions (RI-REQ-029)", async () => {
    await show(view([REWRITE], { gaps: [{ requirement: "Kubernetes", question: "Have you run it?" }] }));

    expect(screen.getByText("Have you run it?")).toBeInTheDocument();
    expect(screen.getByText(/Answer in the chat/)).toBeInTheDocument();
  });

  it("keeps suggestion text as plain text (RI-SEC-003)", async () => {
    await show(view([{ ...REWRITE, suggested: "<img src=x onerror=alert(1)> **bold**" }]));

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("strong")).toBeNull();
  });

  it("says when the review can't be loaded", async () => {
    await show({ ok: false, error: "This review isn't available any more." });

    expect(screen.getByRole("alert")).toHaveTextContent("This review isn't available any more.");
  });

  it("on an older message, still applies but tells nobody, and shows the result itself", async () => {
    applied(["b1"]);
    vi.mocked(loadResumeChangesAction).mockResolvedValue(view([REWRITE]));
    render(<ResumeChangesCard reviewId={REVIEW_ID} />);
    await screen.findByRole("checkbox", { name: /^Rewrite/ });

    vi.mocked(loadResumeChangesAction).mockResolvedValue(
      view([REWRITE], { copy: target(COPY_ID, {}, { b1: { previous: "Worked on billing", text: "Built the billing API" } }) }),
    );
    await userEvent.click(applyButton());

    expect(await screen.findByText(/Applied 1 change/)).toBeInTheDocument();
  });
});

describe("ResumeChangesResult (RI-REQ-029a)", () => {
  const OUTPUT = {
    status: "applied" as const,
    applied: ["b1", "remove-1"],
    skipped: ["move-1"],
    changed: [],
    targetResumeId: COPY_ID,
  };
  const RECORDS = {
    b1: { previous: "Worked on billing", text: "Built the billing API for [N] teams" },
    "remove-1": { previous: "Helped with tests", text: "" },
  };
  const appliedView = (records: ChangesTarget["applied"] = RECORDS) =>
    view([REWRITE, REMOVE, MOVE], { copy: target(COPY_ID, {}, records) });

  it("shows the old line and what was really applied, so the user knows what Undo does", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView());

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    expect((await screen.findByText("Worked on billing")).tagName).toBe("DEL");
    expect(screen.getByText("Built the billing API for [N] teams").tagName).toBe("INS");
    expect(screen.queryByText("Built the billing API")).not.toBeInTheDocument();
  });

  it("reads the original's records when the changes went there", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(
      view([REWRITE], { original: target(SOURCE_ID, {}, { b1: RECORDS.b1 }) }),
    );

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={{ ...OUTPUT, targetResumeId: SOURCE_ID }} />);

    expect(await screen.findByRole("button", { name: /^Undo/ })).toBeInTheDocument();
  });

  it("offers no Undo after a reload for a rewrite already undone", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView({ "remove-1": RECORDS["remove-1"] }));

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    expect(await screen.findByText(/Applied 1 change./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it("keeps the gaps' questions after Apply", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(
      view([REWRITE], {
        copy: target(COPY_ID, {}, { b1: RECORDS.b1 }),
        gaps: [{ requirement: "Kubernetes", question: "Have you run it?" }],
      }),
    );

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    expect(await screen.findByText("Have you run it?")).toBeInTheDocument();
    expect(screen.getByText(/Answer in the chat/)).toBeInTheDocument();
  });

  it("links to the resume, and says what's left", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView());

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    expect(screen.getByRole("link", { name: "Open the resume" })).toHaveAttribute("href", `/resume/${COPY_ID}`);
    expect(screen.getByText(/1 change not applied/)).toBeInTheDocument();
    await screen.findByRole("button", { name: /^Undo/ });
  });

  it("offers Undo on rewrites only (RI-REQ-036)", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView());

    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    expect(await screen.findAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
  });

  it("undoes a rewrite, as the agent surface", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView());
    vi.mocked(undoReviewSuggestionAction).mockResolvedValue({ ok: true, targetResumeId: COPY_ID });
    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    await userEvent.click(await screen.findByRole("button", { name: /^Undo/ }));

    expect(undoReviewSuggestionAction).toHaveBeenCalledWith(
      { reviewId: REVIEW_ID, bulletId: "b1", targetResumeId: COPY_ID },
      "agent",
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument());
    expect(screen.getByText(/Applied 1 change\./)).toBeInTheDocument();
  });

  it("says why an undo failed", async () => {
    vi.mocked(loadResumeChangesAction).mockResolvedValue(appliedView());
    vi.mocked(undoReviewSuggestionAction).mockResolvedValue({
      ok: false,
      code: "BULLET_CHANGED",
      error: "This bullet was edited after applying, so it wasn't undone.",
    });
    render(<ResumeChangesResult reviewId={REVIEW_ID} output={OUTPUT} />);

    await userEvent.click(await screen.findByRole("button", { name: /^Undo/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/edited after applying/);
  });

  it("says nothing changed after a discard", () => {
    render(
      <ResumeChangesResult
        reviewId={REVIEW_ID}
        output={{ status: "discarded", applied: [], skipped: ["b1"], changed: [], targetResumeId: null }}
      />,
    );

    expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
    expect(loadResumeChangesAction).not.toHaveBeenCalled();
  });
});
