import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { mutate } from "swr";
import { applyReviewSuggestionsAction } from "@/app/actions/resume-review/apply-suggestions";
import { undoReviewSuggestionAction } from "@/app/actions/resume-review/undo-suggestion";
import type { TResumeReviewServer } from "@/utils/types/review.types";
import ReviewSuggestions from "./ReviewSuggestions";

vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/resume-review/apply-suggestions", () => ({ applyReviewSuggestionsAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/undo-suggestion", () => ({ undoReviewSuggestionAction: vi.fn() }));

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const COPY_ID = "33333333-3333-4333-8333-333333333333";

const suggestion = (bullet_id: string, suggested: string) => ({
  bullet_id,
  section: "Experience",
  original: `Original ${bullet_id}`,
  suggested,
  reason: "Weak",
  priority: "high",
});

const CONTENT = {
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [
        {
          id: "i1",
          bullets: [
            { id: "b1", text: "Original b1" },
            { id: "b2", text: "Original b2" },
          ],
        },
      ],
    },
  ],
};

const review = (overrides: Record<string, unknown> = {}) =>
  ({
    id: REVIEW_ID,
    resume_id: SOURCE_ID,
    applied_copy_id: null,
    resume_revision: 3,
    resumes: { id: SOURCE_ID, name: "Backend", content: CONTENT, revision: 3 },
    resume_review_applied: [],
    ai_response: {
      bullet_points: [suggestion("b1", "Built the API"), suggestion("b2", "Cut test time by [X%]")],
    },
    ...overrides,
  }) as unknown as TResumeReviewServer;

const onRerun = vi.fn();

const show = (value: TResumeReviewServer) =>
  render(
    <ReviewSuggestions review={value} activeHighlightId={null} setActiveHighlightId={vi.fn()} onRerun={onRerun} />,
  );

const card = (text: string) => screen.getByText(text).closest("div.rounded-xl") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({
    ok: true,
    target: "copy",
    targetResumeId: COPY_ID,
    items: [{ id: "b1", status: "applied" }],
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

describe("applying one suggestion", () => {
  it("opens the text for editing, and sends what the user confirmed to a copy", async () => {
    const user = userEvent.setup();
    show(review());

    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    const field = screen.getByLabelText("Suggested text");
    await user.clear(field);
    await user.type(field, "Built the billing API");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(applyReviewSuggestionsAction).toHaveBeenCalledWith({
      reviewId: REVIEW_ID,
      target: "copy",
      items: [{ id: "b1", text: "Built the billing API" }],
    });
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(`/api/resume-review/${REVIEW_ID}`));
  });

  it("applies to a copy without asking", async () => {
    const user = userEvent.setup();
    show(review());

    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before changing the resume itself", async () => {
    const user = userEvent.setup();
    show(review());

    await user.click(screen.getByRole("radio", { name: "This resume" }));
    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(within(screen.getByRole("alertdialog")).getByText(/rewrites 1 bullet on Backend/)).toBeInTheDocument();
    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply to original" }));

    expect(vi.mocked(applyReviewSuggestionsAction).mock.calls[0][0].target).toBe("original");
    await waitFor(() => expect(screen.queryByLabelText("Suggested text")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the edited text when the user backs out", async () => {
    const user = userEvent.setup();
    show(review());

    await user.click(screen.getByRole("radio", { name: "This resume" }));
    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    await user.type(screen.getByLabelText("Suggested text"), " fast");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Suggested text")).toHaveValue("Built the API fast");
  });

  it("keeps Confirm off until every placeholder has a value", async () => {
    const user = userEvent.setup();
    show(review());

    await user.click(within(card("Cut test time by [X%]")).getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();

    await user.type(screen.getByLabelText("Your real value for [X%]"), "30%");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(vi.mocked(applyReviewSuggestionsAction).mock.calls[0][0].items).toEqual([
      { id: "b2", text: "Cut test time by 30%" },
    ]);
  });

  it("explains a bullet that changed", async () => {
    vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({
      ok: true,
      target: "copy",
      targetResumeId: null,
      items: [{ id: "b1", status: "changed" }],
    });
    const user = userEvent.setup();
    show(review());

    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("changed after the review");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows a refusal", async () => {
    vi.mocked(applyReviewSuggestionsAction).mockResolvedValue({ ok: false, code: "COPY_FAILED", error: "At the limit." });
    const user = userEvent.setup();
    show(review());

    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("At the limit."));
  });
});

describe("Apply all changes", () => {
  it("skips suggestions with placeholders, and says so", async () => {
    const user = userEvent.setup();
    show(review());

    expect(screen.getByText(/1 change needs your real numbers/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply all changes (1)" }));

    expect(vi.mocked(applyReviewSuggestionsAction).mock.calls[0][0].items).toEqual([{ id: "b1" }]);
  });

  it("asks first on the resume itself, with the count", async () => {
    const user = userEvent.setup();
    show(
      review({
        ai_response: { bullet_points: [suggestion("b1", "Built the API"), suggestion("b2", "Sped up the tests")] },
      }),
    );

    await user.click(screen.getByRole("radio", { name: "This resume" }));
    await user.click(screen.getByRole("button", { name: "Apply all changes (2)" }));

    expect(within(screen.getByRole("alertdialog")).getByText(/rewrites 2 bullets/)).toBeInTheDocument();
    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply to original" }));

    expect(applyReviewSuggestionsAction).toHaveBeenCalledWith({
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }, { id: "b2" }],
    });
  });

  it("stays visible but off when every change needs a value", () => {
    show(review({ ai_response: { bullet_points: [suggestion("b2", "Cut by [X%]")] } }));

    expect(screen.getByRole("button", { name: "Apply all changes" })).toBeDisabled();
  });

  it("is gone when everything is applied", () => {
    show(
      review({
        applied_copy_id: COPY_ID,
        ai_response: { bullet_points: [suggestion("b1", "Built the API")] },
        resume_review_applied: [{ bullet_id: "b1", target_resume_id: COPY_ID, applied_text: "Built the API" }],
      }),
    );

    expect(screen.queryByRole("button", { name: /Apply all/ })).not.toBeInTheDocument();
  });
});

describe("applied suggestions", () => {
  const applied = {
    applied_copy_id: COPY_ID,
    resume_review_applied: [{ bullet_id: "b1", target_resume_id: COPY_ID, applied_text: "Built the API" }],
  };

  it("show Applied and links to the target", () => {
    show(review(applied));

    expect(within(card("Built the API")).getByText("Applied")).toBeInTheDocument();
    expect(within(card("Built the API")).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", `/resume/${COPY_ID}`);
  });

  it("are per target", async () => {
    const user = userEvent.setup();
    show(review(applied));

    await user.click(screen.getByRole("radio", { name: "This resume" }));

    expect(within(card("Built the API")).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });

  it("can be undone", async () => {
    vi.mocked(undoReviewSuggestionAction).mockResolvedValue({ ok: true, targetResumeId: COPY_ID });
    const user = userEvent.setup();
    show(review(applied));

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(undoReviewSuggestionAction).toHaveBeenCalledWith({
      reviewId: REVIEW_ID,
      bulletId: "b1",
      targetResumeId: COPY_ID,
    });
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  it("say when an undo can't happen", async () => {
    vi.mocked(undoReviewSuggestionAction).mockResolvedValue({
      ok: false,
      code: "BULLET_CHANGED",
      error: "This bullet was edited.",
    });
    const user = userEvent.setup();
    show(review(applied));

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This bullet was edited."));
  });
});

describe("older reviews (RE-REQ-059a)", () => {
  it("ask for the numbers to be checked, and can't apply all at once", () => {
    show(review({ resume_revision: null }));

    expect(within(card("Built the API")).getByText(/Check the numbers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply all changes" })).toBeDisabled();
    expect(screen.getByText(/may have estimated numbers/)).toBeInTheDocument();
  });

  it("still open for editing before applying", async () => {
    const user = userEvent.setup();
    show(review({ resume_revision: null }));

    await user.click(within(card("Built the API")).getByRole("button", { name: "Apply" }));

    expect(screen.getByLabelText("Suggested text")).toHaveValue("Built the API");
    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();
  });

  it("don't count as out of date", () => {
    show(review({ resume_revision: null }));

    expect(screen.queryByText(/earlier version/)).not.toBeInTheDocument();
  });
});

describe("a bullet that's gone (RE-REQ-094)", () => {
  it("is view-only", () => {
    show(review({ ai_response: { bullet_points: [suggestion("gone", "Rewritten")] } }));

    expect(within(card("Rewritten")).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(within(card("Rewritten")).getByText(/no longer on the resume/)).toBeInTheDocument();
    expect(within(card("Rewritten")).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});

describe("read-only, for the landing page's sample", () => {
  it("offers only Copy", () => {
    render(
      <ReviewSuggestions
        review={review({ resume_revision: undefined })}
        activeHighlightId={null}
        setActiveHighlightId={vi.fn()}
        readOnly
      />,
    );

    expect(within(card("Built the API")).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/Check the numbers/)).not.toBeInTheDocument();
  });
});

describe("the out-of-date notice (RE-REQ-060)", () => {
  it("shows when the revision differs, and offers a new review", async () => {
    const user = userEvent.setup();
    show(review({ resumes: { id: SOURCE_ID, content: CONTENT, revision: 4 } }));

    await user.click(screen.getByRole("button", { name: "Run a new review" }));

    expect(onRerun).toHaveBeenCalled();
  });

  it("stays away when the revision matches", () => {
    show(review());

    expect(screen.queryByText(/earlier version/)).not.toBeInTheDocument();
  });
});
