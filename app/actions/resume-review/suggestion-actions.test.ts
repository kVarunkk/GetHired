import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { applyReviewSuggestions, undoReviewSuggestion } from "@/helpers/resume-review/apply-suggestions";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { applyReviewSuggestionsAction } from "./apply-suggestions";
import { undoReviewSuggestionAction } from "./undo-suggestion";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/resume-review/apply-suggestions", () => ({
  applyReviewSuggestions: vi.fn(),
  undoReviewSuggestion: vi.fn(),
}));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const APPLY = { reviewId: REVIEW_ID, items: [{ id: "b1" }] };
const UNDO = { reviewId: REVIEW_ID, bulletId: "b1", targetResumeId: RESUME_ID };

let supabase: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock({ user: USER });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
});

describe("the surface (RI-REQ-033)", () => {
  it("defaults to the page, and takes the agent's card", async () => {
    vi.mocked(applyReviewSuggestions).mockResolvedValue({ ok: true, target: "copy", targetResumeId: null, items: [] });

    await applyReviewSuggestionsAction(APPLY);
    await applyReviewSuggestionsAction(APPLY, "agent");

    expect(vi.mocked(applyReviewSuggestions).mock.calls[0][3]).toEqual({ surface: "page" });
    expect(vi.mocked(applyReviewSuggestions).mock.calls[1][3]).toEqual({ surface: "agent" });
  });

  it("refuses any other value, since a client sends it", async () => {
    const result = await applyReviewSuggestionsAction(APPLY, "mcp" as "agent");

    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(applyReviewSuggestions).not.toHaveBeenCalled();
  });

  it("reaches undo the same way", async () => {
    vi.mocked(undoReviewSuggestion).mockResolvedValue({ ok: true, targetResumeId: RESUME_ID });

    await undoReviewSuggestionAction(UNDO);
    await undoReviewSuggestionAction(UNDO, "agent");

    expect(vi.mocked(undoReviewSuggestion).mock.calls[0][3]).toEqual({ surface: "page" });
    expect(vi.mocked(undoReviewSuggestion).mock.calls[1][3]).toEqual({ surface: "agent" });
  });

  it("refuses any other value on undo too", async () => {
    await undoReviewSuggestionAction(UNDO, "mcp" as "agent");

    expect(undoReviewSuggestion).not.toHaveBeenCalled();
  });
});

describe("applyReviewSuggestionsAction", () => {
  it("needs a session", async () => {
    supabase.setUser(null);

    expect(await applyReviewSuggestionsAction(APPLY)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(applyReviewSuggestions).not.toHaveBeenCalled();
  });

  it("uses the session user and refreshes the target's pages", async () => {
    vi.mocked(applyReviewSuggestions).mockResolvedValue({
      ok: true,
      target: "copy",
      targetResumeId: RESUME_ID,
      items: [{ id: "b1", status: "applied" }],
    });

    await applyReviewSuggestionsAction(APPLY);

    expect(vi.mocked(applyReviewSuggestions).mock.calls[0][1]).toMatchObject({ id: USER.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
  });

  it("refreshes nothing when nothing was written", async () => {
    vi.mocked(applyReviewSuggestions).mockResolvedValue({
      ok: true,
      target: "copy",
      targetResumeId: null,
      items: [{ id: "b1", status: "changed" }],
    });

    await applyReviewSuggestionsAction(APPLY);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("undoReviewSuggestionAction", () => {
  it("needs a session", async () => {
    supabase.setUser(null);

    expect(await undoReviewSuggestionAction(UNDO)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("can't carry a user id", async () => {
    const input = { ...UNDO, userId: "someone-else" };

    expect(await undoReviewSuggestionAction(input)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(undoReviewSuggestion).not.toHaveBeenCalled();
  });

  it("uses the session user and refreshes the target's pages", async () => {
    vi.mocked(undoReviewSuggestion).mockResolvedValue({ ok: true, targetResumeId: RESUME_ID });

    await undoReviewSuggestionAction(UNDO);

    expect(vi.mocked(undoReviewSuggestion).mock.calls[0][1]).toMatchObject({ id: USER.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
  });
});
