import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { RESUME_LIMITS, RESUME_MAX_PER_USER } from "@/helpers/resume/config";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PostHogEvent } from "@/utils/types";
import { duplicateResume } from "./duplicate-resume";
import { RESUME_LIMIT_ERROR } from "./resume-limit";
import { upgradeResumeFromFile } from "./upgrade-resume";

vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("./upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };

const SOURCE = {
  id: "src",
  name: "Backend",
  content: { version: 2, sections: [{ id: "s1", type: "skills", items: [{ id: "i1", bullets: [{ id: "b1", text: "Go" }] }] }] },
  contact: { fullName: "Ada", links: [] },
  template: "compact",
  revision: 7,
  schema_version: 2,
  resume_path: null,
};

let db: SupabaseMock;

const seed = (source: unknown = SOURCE) => {
  db.queue("resumes", { data: source, error: null });
  db.queue("resumes", { data: null, error: null, count: 1 });
  db.queue("resumes", { data: { id: "copy" }, error: null });
};

const inserted = () =>
  db
    .callsFor("resumes")
    .flatMap((call) => call.chain)
    .find((step) => step.method === "insert")?.args[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("duplicateResume (RE-REQ-040/041)", () => {
  it("copies content, contact and template, keeping every id", async () => {
    seed();

    expect(await duplicateResume(db.client, USER, { resumeId: "src" })).toEqual({ ok: true, resumeId: "copy" });

    expect(inserted()).toMatchObject({ content: SOURCE.content, contact: SOURCE.contact, template: "compact" });
  });

  it("points at its source, isn't primary and starts at revision 1", async () => {
    seed();
    await duplicateResume(db.client, USER, { resumeId: "src" });

    expect(inserted()).toMatchObject({
      user_id: USER.id,
      source_resume_id: "src",
      is_primary: false,
      revision: 1,
      schema_version: 2,
    });
  });

  it("names the copy after its source, or as asked", async () => {
    seed();
    await duplicateResume(db.client, USER, { resumeId: "src" });
    expect(inserted().name).toBe("Backend (copy)");

    db = createSupabaseMock();
    seed();
    await duplicateResume(db.client, USER, { resumeId: "src", name: "Frontend" });
    expect(inserted().name).toBe("Frontend");
  });

  it("keeps a long name inside the limit, so the copy can still be saved", async () => {
    seed({ ...SOURCE, name: "x".repeat(RESUME_LIMITS.shortFieldChars) });
    await duplicateResume(db.client, USER, { resumeId: "src" });

    expect(inserted().name).toHaveLength(RESUME_LIMITS.shortFieldChars);
    expect(inserted().name).toMatch(/ \(copy\)$/);
  });

  it("finds nothing for another user's id", async () => {
    db.queue("resumes", { data: null, error: null });

    expect(await duplicateResume(db.client, USER, { resumeId: "other" })).toMatchObject({ ok: false });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(inserted()).toBeUndefined();
  });

  it("refuses at the limit", async () => {
    db.queue("resumes", { data: SOURCE, error: null });
    db.queue("resumes", { data: null, error: null, count: RESUME_MAX_PER_USER });

    expect(await duplicateResume(db.client, USER, { resumeId: "src" })).toEqual({ ok: false, error: RESUME_LIMIT_ERROR });
    expect(inserted()).toBeUndefined();
  });

  describe("a version 1 source (RE-REQ-095)", () => {
    const V1 = { ...SOURCE, schema_version: 1, content: { sections: [] }, resume_path: "resumes/u/cv.pdf" };

    it("upgrades first, and copies the upgraded resume", async () => {
      db.queue("resumes", { data: V1, error: null });
      db.queue("resumes", { data: null, error: null, count: 1 });
      db.queue("resumes", { data: { ...SOURCE, name: "cv" }, error: null });
      db.queue("resumes", { data: { id: "copy" }, error: null });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });

      expect(await duplicateResume(db.client, USER, { resumeId: "src" })).toMatchObject({ ok: true });

      expect(upgradeResumeFromFile).toHaveBeenCalledWith(V1);
      expect(inserted()).toMatchObject({ content: SOURCE.content, name: "cv (copy)" });
    });

    it("stops when the upgrade fails", async () => {
      db.queue("resumes", { data: V1, error: null });
      db.queue("resumes", { data: null, error: null, count: 1 });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "Upload it again." });

      expect(await duplicateResume(db.client, USER, { resumeId: "src" })).toEqual({ ok: false, error: "Upload it again." });
      expect(inserted()).toBeUndefined();
    });
  });

  it("records resume_duplicated", async () => {
    seed();
    await duplicateResume(db.client, USER, { resumeId: "src" });
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.ResumeDuplicated,
      distinctId: USER.id,
      properties: {},
    });
  });
});
