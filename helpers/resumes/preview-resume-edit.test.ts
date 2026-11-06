import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { describeResumeChanges } from "./resume-changes";
import { LAST_RESUME_ERROR } from "./delete-resume";
import { previewResumeEdit } from "./preview-resume-edit";
import { RESUME_CHANGED_ERROR } from "./save-resume";
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

    expect(await preview("updateResume", EDIT)).toEqual({
      ok: true,
      summary: 'Change "Backend"?',
      changes: [{ label: "Experience, Engineer", before: "Old text", after: "New text" }],
    });
    expect(writes()).toEqual([]);
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

    expect(result).toEqual({
      ok: true,
      summary: 'Create the resume "Design"?',
      changes: [{ label: "Sections", before: "", after: "Skills, Talks" }],
    });
    expect(writes()).toEqual([]);
  });

  it("is an error at the limit", async () => {
    db.queue("resumes", { data: null, error: null, count: 20 });

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

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ bulletId: "b1" }] });

    expect(result).toEqual({
      ok: true,
      summary: 'Apply 1 suggestion to a new copy of "Backend"?',
      changes: [{ label: "Bullet", before: "Old text", after: "Better text" }],
    });
    expect(writes()).toEqual([]);
  });

  it("is an error for an unfilled placeholder", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ bulletId: "b2" }] });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("bracketed") });
  });

  it("is an error when every bullet has changed", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: { ...ROW, content: content("Edited") }, error: null });

    const result = await preview("applyReviewSuggestions", { reviewId: REVIEW_ID, items: [{ bulletId: "b1" }] });

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
