import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { duplicateResume } from "@/helpers/resumes/duplicate-resume";
import { RESUME_CHANGED, saveResume } from "@/helpers/resumes/save-resume";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PostHogEvent } from "@/utils/types";
import { PLACEHOLDER_UNFILLED, applyReviewSuggestions, undoReviewSuggestion } from "./apply-suggestions";

vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/resumes/duplicate-resume", () => ({ duplicateResume: vi.fn() }));
vi.mock("@/helpers/resumes/upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));
vi.mock("@/helpers/resumes/save-resume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resumes/save-resume")>()),
  saveResume: vi.fn(),
}));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const COPY_ID = "33333333-3333-4333-8333-333333333333";

const content = (b1 = "Worked on billing", b2 = "Helped with tests"): ResumeContent => ({
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [
        {
          id: "i1",
          bullets: [
            { id: "b1", text: b1 },
            { id: "b2", text: b2 },
          ],
        },
      ],
    },
  ],
});

const suggestion = (bullet_id: string, original: string, suggested: string) => ({
  bullet_id,
  section: "Experience",
  original,
  suggested,
  reason: "Weak",
  priority: "high",
});

const REVIEW = {
  id: REVIEW_ID,
  name: "Stripe review",
  resume_id: SOURCE_ID,
  applied_copy_id: null as string | null,
  all_jobs: { job_name: "Backend Engineer" } as { job_name: string } | null,
  ai_response: {
    bullet_points: [
      suggestion("b1", "Worked on billing", "Built the billing API"),
      suggestion("b2", "Helped with tests", "Cut test time by [X%]"),
    ],
  },
};

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: "Backend",
  content: content(),
  contact: { fullName: "Ada", links: [] },
  template: "compact",
  revision: 4,
  schema_version: 2,
  resume_path: null,
  ...overrides,
});

let db: SupabaseMock;

const queueReview = (overrides: Record<string, unknown> = {}) =>
  db.queue("resume_reviews", { data: { ...REVIEW, ...overrides }, error: null });
const queueResume = (data: unknown) => db.queue("resumes", { data, error: null });

const savedInput = () => vi.mocked(saveResume).mock.calls[0][2];
const bulletTexts = (saved: ResumeContent) => saved.sections[0].items[0].bullets.map((bullet) => bullet.text);
const appliedRows = () =>
  db
    .callsFor("resume_review_applied")
    .flatMap((call) => call.chain)
    .find((step) => step.method === "upsert")?.args[0] as Record<string, unknown>[] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(saveResume).mockResolvedValue({ ok: true, revision: 2 });
  vi.mocked(duplicateResume).mockResolvedValue({ ok: true, resumeId: COPY_ID });
  vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });
});

describe("applyReviewSuggestions: copy target (RE-REQ-057)", () => {
  const applyOne = () => applyReviewSuggestions(db.client, USER, { reviewId: REVIEW_ID, items: [{ id: "b1" }] });

  it("is the default, and the first apply creates a copy named for the job", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));
    queueResume(row(COPY_ID, { revision: 1 }));

    const result = await applyOne();

    expect(duplicateResume).toHaveBeenCalledWith(db.client, USER, {
      resumeId: SOURCE_ID,
      name: "Backend – Backend Engineer",
    });
    expect(result).toEqual({
      ok: true,
      target: "copy",
      targetResumeId: COPY_ID,
      items: [{ id: "b1", status: "applied" }],
    });
    expect(savedInput()).toMatchObject({ resumeId: COPY_ID, expectedRevision: 1, template: "compact" });
    expect(bulletTexts(savedInput().content)).toEqual(["Built the billing API", "Helped with tests"]);
  });

  it("stores the copy on the review", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));
    queueResume(row(COPY_ID, { revision: 1 }));

    await applyOne();

    const stored = db.callsFor("resume_reviews").find((call) => call.chain.some((step) => step.method === "update"));
    expect(stored?.chain).toContainEqual({ method: "update", args: [{ applied_copy_id: COPY_ID }] });
    expect(stored?.chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });

  it("names the copy after the review when there's no job", async () => {
    queueReview({ all_jobs: null });
    queueResume(row(SOURCE_ID));
    queueResume(row(COPY_ID));

    await applyOne();

    expect(vi.mocked(duplicateResume).mock.calls[0][2].name).toBe("Backend – Stripe review");
  });

  it("reuses the copy on later applies", async () => {
    queueReview({ applied_copy_id: COPY_ID });
    queueResume(row(COPY_ID, { revision: 6 }));

    await applyOne();

    expect(duplicateResume).not.toHaveBeenCalled();
    expect(savedInput()).toMatchObject({ resumeId: COPY_ID, expectedRevision: 6 });
  });

  it("makes a new copy when the last one was deleted", async () => {
    queueReview({ applied_copy_id: COPY_ID });
    queueResume(null);
    queueResume(row(SOURCE_ID));
    queueResume(row("44444444-4444-4444-8444-444444444444", { revision: 1 }));
    vi.mocked(duplicateResume).mockResolvedValue({ ok: true, resumeId: "44444444-4444-4444-8444-444444444444" });

    const result = await applyOne();

    expect(duplicateResume).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, targetResumeId: "44444444-4444-4444-8444-444444444444" });
  });

  it("makes no copy when nothing would apply", async () => {
    queueReview();
    queueResume(row(SOURCE_ID, { content: content("Rewritten by hand") }));

    const result = await applyOne();

    expect(duplicateResume).not.toHaveBeenCalled();
    expect(saveResume).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, targetResumeId: null, items: [{ id: "b1", status: "changed" }] });
  });

  it("passes on the limit when a copy can't be made", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));
    vi.mocked(duplicateResume).mockResolvedValue({ ok: false, error: "You've reached the limit." });

    expect(await applyOne()).toEqual({ ok: false, code: "COPY_FAILED", error: "You've reached the limit." });
    expect(saveResume).not.toHaveBeenCalled();
  });
});

describe("applyReviewSuggestions: original target", () => {
  it("writes to the reviewed resume and makes no copy", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }],
    });

    expect(duplicateResume).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, target: "original", targetResumeId: SOURCE_ID });
    expect(savedInput()).toMatchObject({ resumeId: SOURCE_ID, expectedRevision: 4 });
  });

  it("upgrades a version 1 resume first, and applies to what the upgrade wrote", async () => {
    queueReview();
    queueResume(row(SOURCE_ID, { schema_version: 1, resume_path: "u/r.pdf" }));
    queueResume(row(SOURCE_ID, { revision: 5 }));

    await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }],
    });

    expect(upgradeResumeFromFile).toHaveBeenCalledTimes(1);
    expect(savedInput().expectedRevision).toBe(5);
  });

  it("stops when the upgrade fails", async () => {
    queueReview();
    queueResume(row(SOURCE_ID, { schema_version: 1 }));
    vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "Upload it again." });

    expect(
      await applyReviewSuggestions(db.client, USER, {
        reviewId: REVIEW_ID,
        target: "original",
        items: [{ id: "b1" }],
      }),
    ).toEqual({ ok: false, code: "UPGRADE_FAILED", error: "Upload it again." });
    expect(saveResume).not.toHaveBeenCalled();
  });
});

describe("applyReviewSuggestions: per-bullet check (RE-REQ-058)", () => {
  const applyBoth = () =>
    applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }, { id: "b2", text: "Cut test time by 30%" }],
    });

  it("reports a changed bullet, applies the rest, and saves once", async () => {
    queueReview();
    queueResume(row(SOURCE_ID, { content: content("Edited by the user") }));

    const result = await applyBoth();

    expect(result).toMatchObject({
      ok: true,
      items: [
        { id: "b1", status: "changed" },
        { id: "b2", status: "applied" },
      ],
    });
    expect(saveResume).toHaveBeenCalledTimes(1);
    expect(bulletTexts(savedInput().content)).toEqual(["Edited by the user", "Cut test time by 30%"]);
  });

  it("treats a bullet removed from the target as changed", async () => {
    queueReview();
    queueResume(
      row(SOURCE_ID, {
        content: { version: 2, sections: [{ id: "s1", type: "experience", items: [{ id: "i1", bullets: [] }] }] },
      }),
    );

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }],
    });

    expect(result).toMatchObject({ ok: true, items: [{ id: "b1", status: "changed" }] });
  });

  it("ignores case, spacing and punctuation differences from an older review", async () => {
    queueReview({ ai_response: { bullet_points: [suggestion("b1", "worked on  billing.", "Built the billing API")] } });
    queueResume(row(SOURCE_ID));

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }],
    });

    expect(result).toMatchObject({ ok: true, items: [{ id: "b1", status: "applied" }] });
  });

  it("reports a bullet the review has no suggestion for", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }, { id: "nope" }],
    });

    expect(result).toMatchObject({
      ok: true,
      items: [
        { id: "b1", status: "applied" },
        { id: "nope", status: "not_found" },
      ],
    });
  });

  it("passes on a stale revision without recording anything", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));
    vi.mocked(saveResume).mockResolvedValue({ ok: false, code: RESUME_CHANGED, error: "Changed." });

    expect(await applyBoth()).toEqual({ ok: false, code: RESUME_CHANGED, error: "Changed." });
    expect(appliedRows()).toBeUndefined();
  });
});

describe("applyReviewSuggestions: placeholders (RE-REQ-059)", () => {
  it("refuses the model's text with a placeholder and writes nothing", async () => {
    queueReview();

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      items: [{ id: "b1" }, { id: "b2" }],
    });

    expect(result).toMatchObject({ ok: false, code: PLACEHOLDER_UNFILLED, ids: ["b2"] });
    expect(duplicateResume).not.toHaveBeenCalled();
    expect(saveResume).not.toHaveBeenCalled();
  });

  it("refuses the user's text with a placeholder", async () => {
    queueReview();

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      items: [{ id: "b1", text: "Built it for [team]" }],
    });

    expect(result).toMatchObject({ ok: false, code: PLACEHOLDER_UNFILLED, ids: ["b1"] });
  });

  it("lets a filled-in placeholder through", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b2", text: "Cut test time by 30%" }],
    });

    expect(result).toMatchObject({ ok: true, items: [{ id: "b2", status: "applied" }] });
  });
});

describe("applyReviewSuggestions: records and access", () => {
  it("records what was applied, with the text it replaced", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));

    await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1", text: "My own words" }],
    });

    expect(appliedRows()).toEqual([
      {
        review_id: REVIEW_ID,
        bullet_id: "b1",
        target_resume_id: SOURCE_ID,
        previous_text: "Worked on billing",
        applied_text: "My own words",
        applied_at: expect.any(String),
      },
    ]);
  });

  it("reports a failed record without failing the apply, which already saved", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));
    db.queue("resume_review_applied", { data: [], error: null });
    db.queue("resume_review_applied", { data: null, error: { message: "boom" } });

    const result = await applyReviewSuggestions(db.client, USER, {
      reviewId: REVIEW_ID,
      target: "original",
      items: [{ id: "b1" }],
    });

    expect(result).toMatchObject({ ok: true });
    expect(reportError).toHaveBeenCalled();
  });

  it("limits the review to the user, and returns not found for anyone else's", async () => {
    db.queue("resume_reviews", { data: null, error: null });

    const result = await applyReviewSuggestions(db.client, USER, { reviewId: REVIEW_ID, items: [{ id: "b1" }] });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND", error: "Review not found." });
    expect(db.callsFor("resume_reviews")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });

  it("refuses bad input before reading anything", async () => {
    const result = await applyReviewSuggestions(db.client, USER, { reviewId: "nope", items: [] });

    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(db.calls).toHaveLength(0);
  });

  it("captures the count, target and surface, and no text", async () => {
    queueReview();
    queueResume(row(SOURCE_ID));

    await applyReviewSuggestions(
      db.client,
      USER,
      { reviewId: REVIEW_ID, target: "original", items: [{ id: "b1" }] },
      { surface: "agent" },
    );
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.ReviewSuggestionsApplied,
      distinctId: USER.id,
      properties: {
        count: 1,
        applied: 1,
        skipped: 0,
        kind_counts: { rewrite: 1 },
        target: "original",
        surface: "agent",
      },
    });
  });
});

describe("undoReviewSuggestion (RE-REQ-060)", () => {
  const APPLIED = { previous_text: "Worked on billing", applied_text: "Built the billing API" };
  const undo = () =>
    undoReviewSuggestion(db.client, USER, { reviewId: REVIEW_ID, bulletId: "b1", targetResumeId: COPY_ID });

  const seed = (bullet: string) => {
    db.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });
    db.queue("resume_review_applied", { data: APPLIED, error: null });
    queueResume(row(COPY_ID, { content: content(bullet) }));
  };

  it("restores the text and removes the record", async () => {
    seed("Built the billing API");

    expect(await undo()).toEqual({ ok: true, targetResumeId: COPY_ID });
    expect(bulletTexts(savedInput().content)[0]).toBe("Worked on billing");
    const removed = db.callsFor("resume_review_applied")[1];
    expect(removed.chain).toContainEqual({ method: "delete", args: [] });
    expect(removed.chain).toContainEqual({ method: "eq", args: ["target_resume_id", COPY_ID] });
  });

  it("leaves a bullet that was edited since", async () => {
    seed("Edited again by hand");

    expect(await undo()).toMatchObject({ ok: false, code: "BULLET_CHANGED" });
    expect(saveResume).not.toHaveBeenCalled();
    expect(db.callsFor("resume_review_applied")).toHaveLength(1);
  });

  it("keeps the record when the save fails", async () => {
    seed("Built the billing API");
    vi.mocked(saveResume).mockResolvedValue({ ok: false, code: RESUME_CHANGED, error: "Changed." });

    expect(await undo()).toEqual({ ok: false, code: RESUME_CHANGED, error: "Changed." });
    expect(db.callsFor("resume_review_applied")).toHaveLength(1);
  });

  it("returns not found for another user's review", async () => {
    db.queue("resume_reviews", { data: null, error: null });

    expect(await undo()).toEqual({ ok: false, code: "NOT_FOUND", error: "Review not found." });
    expect(db.callsFor("resume_review_applied")).toHaveLength(0);
  });

  it("returns not found when nothing was applied", async () => {
    db.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });
    db.queue("resume_review_applied", { data: null, error: null });

    expect(await undo()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("applyReviewSuggestions: every kind of change (RI-REQ-030)", () => {
  const ADD = { kind: "add", id: "add-1", item_id: "i1", anchors: ["b1"], suggested: "Mentored two engineers", reason: "r", priority: "high" };
  const REMOVE = { kind: "remove", id: "remove-1", bullet_id: "b2", original: "Helped with tests", reason: "r", priority: "low" };
  const MOVE = { kind: "move", id: "move-1", target_id: "b2", index: 0, reason: "r", priority: "low" };
  const PLACEHOLDER_ADD = { ...ADD, id: "add-2", suggested: "Led [N] engineers" };

  const withChanges = (changes: unknown[], overrides: Record<string, unknown> = {}) =>
    queueReview({ ai_response: { ...REVIEW.ai_response, changes }, ...overrides });

  const apply = (items: { id: string; text?: string }[], target: "copy" | "original" = "original") =>
    applyReviewSuggestions(db.client, USER, { reviewId: REVIEW_ID, target, items });

  it("applies only what was chosen", async () => {
    withChanges([ADD, REMOVE]);
    queueResume(row(SOURCE_ID));

    const result = await apply([{ id: "b1" }, { id: "add-1" }]);

    expect(result).toMatchObject({
      ok: true,
      items: [{ id: "b1", status: "applied" }, { id: "add-1", status: "applied" }],
    });
    expect(bulletTexts(savedInput().content)).toEqual([
      "Built the billing API",
      "Mentored two engineers",
      "Helped with tests",
    ]);
  });

  it("saves once, with the add under its change id", async () => {
    withChanges([ADD]);
    queueResume(row(SOURCE_ID));

    await apply([{ id: "add-1" }]);

    expect(saveResume).toHaveBeenCalledTimes(1);
    expect(savedInput().content.sections[0].items[0].bullets[1].id).toBe("add-1");
  });

  it("removes and moves", async () => {
    withChanges([REMOVE]);
    queueResume(row(SOURCE_ID));
    await apply([{ id: "remove-1" }]);
    expect(bulletTexts(savedInput().content)).toEqual(["Worked on billing"]);

    vi.mocked(saveResume).mockClear();
    withChanges([MOVE]);
    queueResume(row(SOURCE_ID));
    await apply([{ id: "move-1" }]);
    expect(bulletTexts(savedInput().content)).toEqual(["Helped with tests", "Worked on billing"]);
  });

  it("records each kind, with empty text where a kind has none (RI-REQ-043)", async () => {
    withChanges([ADD, REMOVE]);
    queueResume(row(SOURCE_ID));

    await apply([{ id: "add-1" }, { id: "remove-1" }]);

    expect(appliedRows()).toEqual([
      expect.objectContaining({ bullet_id: "add-1", previous_text: "", applied_text: "Mentored two engineers" }),
      expect.objectContaining({ bullet_id: "remove-1", previous_text: "Helped with tests", applied_text: "" }),
    ]);
  });

  it("skips what's already on the target, so an add can't land twice (RI-REQ-034)", async () => {
    withChanges([ADD, REMOVE]);
    queueResume(row(SOURCE_ID));
    db.queue("resume_review_applied", { data: [{ bullet_id: "add-1" }], error: null });

    const result = await apply([{ id: "add-1" }, { id: "remove-1" }]);

    expect(result).toMatchObject({
      ok: true,
      items: [{ id: "add-1", status: "already_applied" }, { id: "remove-1", status: "applied" }],
    });
    expect(bulletTexts(savedInput().content)).toEqual(["Worked on billing"]);
  });

  it("writes nothing when everything chosen is already there", async () => {
    withChanges([ADD]);
    queueResume(row(SOURCE_ID));
    db.queue("resume_review_applied", { data: [{ bullet_id: "add-1" }], error: null });

    const result = await apply([{ id: "add-1" }]);

    expect(result).toEqual({
      ok: true,
      target: "original",
      targetResumeId: null,
      items: [{ id: "add-1", status: "already_applied" }],
    });
    expect(saveResume).not.toHaveBeenCalled();
  });

  it("checks the copy's record when re-applying to the copy", async () => {
    withChanges([ADD], { applied_copy_id: COPY_ID });
    queueResume(row(COPY_ID));

    await apply([{ id: "add-1" }], "copy");

    const read = db.callsFor("resume_review_applied")[0];
    expect(read.chain).toContainEqual({ method: "eq", args: ["target_resume_id", COPY_ID] });
    expect(duplicateResume).not.toHaveBeenCalled();
  });

  it("refuses an add with a placeholder, and the whole call with it (RI-REQ-035)", async () => {
    withChanges([PLACEHOLDER_ADD]);

    const result = await apply([{ id: "b1" }, { id: "add-2" }]);

    expect(result).toMatchObject({ ok: false, code: PLACEHOLDER_UNFILLED, ids: ["add-2"] });
    expect(saveResume).not.toHaveBeenCalled();
  });

  it("takes the user's value for a placeholder in an add", async () => {
    withChanges([PLACEHOLDER_ADD]);
    queueResume(row(SOURCE_ID));

    await apply([{ id: "add-2", text: "Led 4 engineers" }]);

    expect(bulletTexts(savedInput().content)).toContain("Led 4 engineers");
  });

  it("doesn't check a removal's text for placeholders", async () => {
    withChanges([{ ...REMOVE, original: "Helped with [tests]" }]);
    queueResume(row(SOURCE_ID, { content: content("Worked on billing", "Helped with [tests]") }));

    expect(await apply([{ id: "remove-1" }])).toMatchObject({ ok: true });
  });

  it("reports an id the review doesn't have", async () => {
    withChanges([ADD]);
    queueResume(row(SOURCE_ID));

    const result = await apply([{ id: "add-1" }, { id: "made-up" }]);

    expect(result).toMatchObject({ items: [{ id: "add-1", status: "applied" }, { id: "made-up", status: "not_found" }] });
  });

  it("counts by kind in the event, and never the text (RI-REQ-070)", async () => {
    withChanges([ADD, REMOVE]);
    queueResume(row(SOURCE_ID));

    await apply([{ id: "b1" }, { id: "add-1" }, { id: "remove-1" }, { id: "made-up" }]);
    await flushAfter();

    const { properties } = vi.mocked(eventCaptureServer).mock.calls[0][0] as { properties: Record<string, unknown> };
    expect(properties).toMatchObject({ applied: 3, skipped: 1, kind_counts: { rewrite: 1, add: 1, remove: 1 } });
    expect(JSON.stringify(properties)).not.toContain("Mentored");
  });
});

describe("undoReviewSuggestion: only rewrites (RI-REQ-036)", () => {
  const undo = (bulletId: string) =>
    undoReviewSuggestion(db.client, USER, { reviewId: REVIEW_ID, bulletId, targetResumeId: SOURCE_ID });

  it.each([
    ["an add", { previous_text: "", applied_text: "New bullet" }],
    ["a removal", { previous_text: "Old bullet", applied_text: "" }],
    ["a move", { previous_text: "", applied_text: "" }],
  ])("refuses %s", async (_kind, record) => {
    db.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });
    db.queue("resume_review_applied", { data: record, error: null });

    expect(await undo("change-1")).toEqual({ ok: false, code: "INVALID", error: "Only a rewrite can be undone." });
    expect(saveResume).not.toHaveBeenCalled();
  });
});
