import { RESUME_MAX_PER_USER } from "@/helpers/resume/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDocument } from "@/helpers/resume/render/document";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { describeResumeChanges } from "./resume-changes";
import { LAST_RESUME_ERROR } from "./delete-resume";
import { previewResumeEdit } from "./preview-resume-edit";
import { RESUME_CHANGED_ERROR } from "./save-resume";
import { RESUME_PLACEHOLDER_ERROR } from "./update-resume";
import { upgradeResumeFromFile } from "./upgrade-resume";

vi.mock("./upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";

const content = (text = "Old text"): ResumeContent => ({
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [{ id: "i1", heading: "Engineer", bullets: [{ id: "b1", text }] }],
    },
  ],
});

const ROW = {
  id: RESUME_ID,
  name: "Backend",
  content: content(),
  contact: { fullName: "Ada", links: [] },
  template: "classic",
  revision: 3,
  schema_version: 2,
  resume_path: null,
};

const EDIT = {
  resumeId: RESUME_ID,
  expectedRevision: 3,
  operations: [{ op: "setBulletText", bulletId: "b1", text: "New text" }],
};

const REVIEW = {
  id: REVIEW_ID,
  name: "Stripe",
  resume_id: RESUME_ID,
  applied_copy_id: null,
  all_jobs: null,
  ai_response: {
    bullet_points: [
      { bullet_id: "b1", section: "x", original: "Old text", suggested: "Better text", reason: "r", priority: "high" },
      { bullet_id: "b2", section: "x", original: "o", suggested: "Grew by [X%]", reason: "r", priority: "high" },
    ],
  },
};

let db: SupabaseMock;

const writes = () =>
  db.calls.flatMap((call) =>
    call.chain.filter((step) => ["insert", "update", "upsert", "delete"].includes(step.method)),
  );

const preview = (tool: Parameters<typeof previewResumeEdit>[2], input: unknown) =>
  previewResumeEdit(db.client, USER, tool, input);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("previewing updateResume (RE-REQ-072)", () => {
  it("shows the before and after, and writes nothing", async () => {
    db.queue("resumes", { data: ROW, error: null });

    expect(await preview("updateResume", EDIT)).toMatchObject({
      ok: true,
      summary: 'Change "Backend"?',
      changes: [{ label: "Experience, Engineer", before: "Old text", after: "New text" }],
    });
    expect(writes()).toEqual([]);
  });

  it("carries both documents for the diff (RI-REQ-003)", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("updateResume", EDIT);

    const bulletOf = (document?: ResumeDocument) => document?.sections[0].items[0].bullets[0];
    expect(result.ok && bulletOf(result.before)).toEqual({ id: "b1", text: "Old text" });
    expect(result.ok && bulletOf(result.after)).toEqual({ id: "b1", text: "New text" });
  });

  describe("placeholders (RI-REQ-006)", () => {
    const refused = async (operation: unknown) => {
      const result = await preview("updateResume", { ...EDIT, operations: [operation] });
      expect(result).toEqual({ ok: false, error: RESUME_PLACEHOLDER_ERROR });
    };

    it("refuses one in a bullet, before reading the resume", async () => {
      await refused({ op: "setBulletText", bulletId: "b1", text: "Grew revenue by [X%]" });
      await refused({ op: "addBullet", itemId: "i1", text: "Led [N] engineers" });

      expect(db.callsFor("resumes")).toEqual([]);
    });

    it("refuses one in an entry, a section title or the contact details", async () => {
      await refused({ op: "addItem", sectionId: "s1", bullets: ["Saved [X] hours"] });
      await refused({ op: "addItem", sectionId: "s1", fields: { heading: "[Company]" } });
      await refused({ op: "setItemFields", itemId: "i1", fields: { subheading: "[Team]" } });
      await refused({ op: "setSectionTitle", sectionId: "s1", title: "[Title]" });
      await refused({ op: "setContact", fields: { headline: "[Role]" } });
    });

    it("refuses the whole list for one placeholder", async () => {
      const result = await preview("updateResume", {
        ...EDIT,
        operations: [EDIT.operations[0], { op: "addBullet", itemId: "i1", text: "Led [N] engineers" }],
      });

      expect(result).toEqual({ ok: false, error: RESUME_PLACEHOLDER_ERROR });
    });

    it("leaves a link and the resume's own name alone", async () => {
      db.queue("resumes", { data: ROW, error: null });

      const result = await preview("updateResume", {
        ...EDIT,
        operations: [
          { op: "setItemFields", itemId: "i1", fields: { url: "https://example.com/a[1]" } },
          { op: "rename", name: "Backend [Stripe]" },
        ],
      });

      expect(result).toMatchObject({ ok: true });
    });
  });

  it("limits the read to the user", async () => {
    db.queue("resumes", { data: null, error: null });

    expect(await preview("updateResume", EDIT)).toEqual({ ok: false, error: "Resume not found." });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });

  it("is an error for a stale revision", async () => {
    db.queue("resumes", { data: { ...ROW, revision: 4 }, error: null });

    expect(await preview("updateResume", EDIT)).toEqual({ ok: false, error: RESUME_CHANGED_ERROR });
  });

  it("is an error for an unknown id", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("updateResume", { ...EDIT, operations: [{ op: "removeBullet", bulletId: "nope" }] });

    expect(result).toMatchObject({ ok: false });
  });

  it("is an error when nothing would change", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("updateResume", {
      ...EDIT,
      operations: [{ op: "setBulletText", bulletId: "b1", text: "Old text" }],
    });

    expect(result).toMatchObject({ ok: false });
  });

  it("doesn't upgrade a version 1 resume, because a preview has no side effects", async () => {
    db.queue("resumes", { data: { ...ROW, schema_version: 1 }, error: null });

    await preview("updateResume", EDIT);

    expect(upgradeResumeFromFile).not.toHaveBeenCalled();
  });

  it("keeps candidate-style text as plain text", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("updateResume", {
      ...EDIT,
      operations: [{ op: "setBulletText", bulletId: "b1", text: "<script>alert(1)</script>" }],
    });

    expect(result).toMatchObject({ ok: true, changes: [{ after: "<script>alert(1)</script>" }] });
  });
});

describe("previewing createResume", () => {
  it("names the sections, and writes nothing", async () => {
    db.queue("resumes", { data: null, error: null, count: 1 });

    const result = await preview("createResume", {
      name: "Design",
      sections: [{ type: "skills", items: [] }, { type: "other", title: "Talks", items: [] }],
    });

    expect(result).toMatchObject({
      ok: true,
      summary: 'Create the resume "Design"?',
      changes: [{ label: "Sections", before: "", after: "Skills, Talks" }],
    });
    expect(writes()).toEqual([]);
  });

  it("shows every item and bullet, with the profile's contact only on the card", async () => {
    db.queue("resumes", { data: null, error: null, count: 1 });
    db.queue("user_info", { data: { full_name: "Ada", email: "ada@example.com" }, error: null });

    const result = await preview("createResume", {
      name: "Frontend",
      sections: [
        {
          type: "experience",
          items: [{ heading: "Engineer", subheading: "Acme", startDate: "Jan 2022", bullets: ["Built the checkout"] }],
        },
      ],
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { label: "Sections", before: "", after: "Experience" },
        { label: "Experience, Engineer: Subheading", before: "", after: "Acme" },
        { label: "Experience, Engineer", before: "", after: "Built the checkout" },
      ]),
    );
    expect(JSON.stringify(result.changes)).not.toContain("ada@example.com");
    expect(result.before?.sections).toEqual([]);
    expect(result.after?.name).toBe("Ada");
    expect(JSON.stringify(result.after?.sections)).toContain("Built the checkout");
    expect(writes()).toEqual([]);
  });

  it("says a resume without sections starts empty", async () => {
    db.queue("resumes", { data: null, error: null, count: 1 });

    expect(await preview("createResume", {})).toEqual({
      ok: true,
      summary: 'Create the resume "Untitled resume"? It starts empty.',
      changes: [],
    });
  });

  it("is an error at the limit", async () => {
    db.queue("resumes", { data: null, error: null, count: RESUME_MAX_PER_USER });

    expect(await preview("createResume", {})).toMatchObject({ ok: false });
  });
});

describe("previewing deleteResume", () => {
  it("says how many reviews go with it, and writes nothing", async () => {
    db.queue("resumes", { data: [ROW, { id: "other", name: "Other" }], error: null });
    db.queue("resume_reviews", { data: null, error: null, count: 2 });

    const result = await preview("deleteResume", { resumeId: RESUME_ID });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.summary).toContain('Delete "Backend"');
    expect(result.ok && result.summary).toContain("2 reviews");
    expect(writes()).toEqual([]);
  });

  it("is an error for the last resume", async () => {
    db.queue("resumes", { data: [ROW], error: null });

    expect(await preview("deleteResume", { resumeId: RESUME_ID })).toEqual({ ok: false, error: LAST_RESUME_ERROR });
  });

  it("is an error for another user's resume", async () => {
    db.queue("resumes", { data: [{ id: "mine", name: "Mine" }, { id: "also", name: "Also" }], error: null });

    expect(await preview("deleteResume", { resumeId: RESUME_ID })).toEqual({ ok: false, error: "Resume not found." });
  });
});

describe("previewing applyReviewSuggestions", () => {
  it("shows the before and after, says a copy is made, and writes nothing", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "b1" }] });

    expect(result).toMatchObject({
      ok: true,
      summary: 'Apply 1 suggestion to a new copy of "Backend"?',
      changes: [{ label: "Bullet", before: "Old text", after: "Better text" }],
    });
    expect(result.ok && result.before?.sections[0].items[0].bullets[0].text).toBe("Old text");
    expect(result.ok && result.after?.sections[0].items[0].bullets[0].text).toBe("Better text");
    expect(writes()).toEqual([]);
  });

  it("is an error for an unfilled placeholder", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "b2" }] });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("bracketed") });
  });

  it("is an error when every bullet has changed", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: { ...ROW, content: content("Edited") }, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "b1" }] });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
  });
});

describe("describeResumeChanges", () => {
  const draft = (overrides = {}) => ({ content: content(), contact: { fullName: "Ada", links: [] }, ...overrides });

  it("shows an added and a removed bullet", () => {
    const added = content();
    added.sections[0].items[0].bullets.push({ id: "b2", text: "Added" });

    expect(describeResumeChanges(draft(), draft({ content: added }))).toEqual([
      { label: "Experience, Engineer", before: "", after: "Added" },
    ]);
    expect(describeResumeChanges(draft({ content: added }), draft())).toEqual([
      { label: "Experience, Engineer", before: "Added", after: "" },
    ]);
  });

  it("shows contact, name and template changes", () => {
    expect(
      describeResumeChanges(
        draft({ name: "A", template: "classic" }),
        draft({ name: "B", template: "compact", contact: { fullName: "Ada L", links: [] } }),
      ),
    ).toEqual([
      { label: "Resume name", before: "A", after: "B" },
      { label: "Template", before: "classic", after: "compact" },
      { label: "Full name", before: "Ada", after: "Ada L" },
    ]);
  });

  it("calls a move a single change", () => {
    const two = content();
    two.sections.push({ id: "s2", type: "skills", items: [] });
    const moved = { ...two, sections: [...two.sections].reverse() };

    expect(describeResumeChanges(draft({ content: two }), draft({ content: moved }))).toEqual([
      { label: "Order", before: "", after: "Parts of the resume move" },
    ]);
  });

  it("finds nothing in the same resume", () => {
    expect(describeResumeChanges(draft(), draft())).toEqual([]);
  });
});

describe("previewing every kind of change (RI-REQ-054)", () => {
  const why = { reason: "r", priority: "low" };
  const withChange = (change: unknown) => ({
    ...REVIEW,
    ai_response: { ...REVIEW.ai_response, changes: [change] },
  });

  it("lists an add as text, for MCP", async () => {
    db.queue("resume_reviews", {
      data: withChange({ ...why, kind: "add", id: "add-1", item_id: "i1", anchors: ["b1"], suggested: "Led the team" }),
      error: null,
    });
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "add-1" }] });

    expect(result).toMatchObject({ ok: true, changes: [{ label: "New bullet", before: "", after: "Led the team" }] });
    expect(writes()).toEqual([]);
  });

  it("lists a removal", async () => {
    db.queue("resume_reviews", {
      data: withChange({ ...why, kind: "remove", id: "remove-1", bullet_id: "b1", original: "Old text" }),
      error: null,
    });
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "remove-1" }] });

    expect(result).toMatchObject({ ok: true, changes: [{ label: "Removed bullet", before: "Old text", after: "" }] });
  });

  it("lists a move", async () => {
    db.queue("resume_reviews", {
      data: withChange({ ...why, kind: "move", id: "move-1", target_id: "b1", index: 0 }),
      error: null,
    });
    db.queue("resumes", { data: ROW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "move-1" }] });

    expect(result).toMatchObject({ ok: true, changes: [{ label: "Order", after: "Moves to a new position" }] });
  });

  it("leaves out what's already on the copy", async () => {
    db.queue("resume_reviews", { data: { ...REVIEW, applied_copy_id: RESUME_ID }, error: null });
    db.queue("resumes", { data: ROW, error: null });
    db.queue("resume_review_applied", { data: [{ bullet_id: "b1" }], error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ id: "b1" }] });

    expect(result).toMatchObject({ ok: false });
  });
});
