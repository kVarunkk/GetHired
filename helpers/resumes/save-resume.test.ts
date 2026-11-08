import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { refreshProfileAfterChange } from "@/helpers/user/queue-profile-refresh";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PostHogEvent } from "@/utils/types";
import { RESUME_CHANGED, saveResume, type SaveResumeInput } from "./save-resume";
import { upgradeResumeFromFile } from "./upgrade-resume";

vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/user/queue-profile-refresh", () => ({ refreshProfileAfterChange: vi.fn() }));
vi.mock("./upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const contentWith = (text: string, type: "experience" | "education" = "experience"): ResumeContent => ({
  version: 2,
  sections: [{ id: "s1", type, items: [{ id: "i1", bullets: [{ id: "b1", text }] }] }],
});

const INPUT: SaveResumeInput = {
  resumeId: RESUME_ID,
  expectedRevision: 3,
  contact: { fullName: "Ada", links: [] },
  content: contentWith("Built the billing API"),
  name: "Backend",
  template: "classic",
};

const CURRENT = {
  id: RESUME_ID,
  name: "Backend",
  content: contentWith("Built the billing API"),
  is_primary: false,
  revision: 3,
  schema_version: 2,
  resume_path: null,
};

let db: SupabaseMock;

const seed = (row: unknown = CURRENT, saved: unknown = { id: RESUME_ID }) => {
  db.queue("resumes", { data: row, error: null });
  db.queue("resumes", { data: saved, error: null });
};

const updateCall = () => db.callsFor("resumes").find((c) => c.chain.some((step) => step.method === "update"));
const updateArgs = () => updateCall()?.chain.find((c) => c.method === "update")?.args[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(refreshProfileAfterChange).mockResolvedValue("queued");
});

describe("saveResume (RE-REQ-033)", () => {
  it("writes the resume and raises the revision", async () => {
    seed();

    expect(await saveResume(db.client, USER, INPUT)).toEqual({ ok: true, revision: 4 });

    expect(updateArgs()).toMatchObject({
      contact: INPUT.contact,
      content: INPUT.content,
      name: "Backend",
      template: "classic",
      revision: 4,
    });
  });

  it("only writes the revision it read, and only this user's resume", async () => {
    seed();
    await saveResume(db.client, USER, INPUT);

    const { chain } = updateCall()!;
    expect(chain).toContainEqual({ method: "eq", args: ["revision", 3] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", RESUME_ID] });
  });

  it("returns RESUME_CHANGED for a stale revision, with nothing written", async () => {
    seed(CURRENT, null);

    expect(await saveResume(db.client, USER, INPUT)).toMatchObject({ ok: false, code: RESUME_CHANGED });
    await flushAfter();
    expect(eventCaptureServer).not.toHaveBeenCalled();
    expect(refreshProfileAfterChange).not.toHaveBeenCalled();
  });

  it("finds nothing for another user's id", async () => {
    db.queue("resumes", { data: null, error: null });

    expect(await saveResume(db.client, USER, INPUT)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(updateCall()).toBeUndefined();
  });

  it.each([
    ["an unsafe link", { contact: { fullName: "Ada", links: [{ label: "x", url: "javascript:alert(1)" }] } }],
    ["an empty bullet", { content: contentWith(" ") }],
    ["a blank name", { name: "  " }],
    ["an unknown template", { template: "fancy" }],
    ["a bad revision", { expectedRevision: 0 }],
    ["a bad id", { resumeId: "nope" }],
  ])("refuses %s, touching nothing", async (_label, change) => {
    const result = await saveResume(db.client, USER, { ...INPUT, ...change } as SaveResumeInput);

    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(db.calls).toHaveLength(0);
  });

  it("strips what the schema doesn't know before writing", async () => {
    seed();
    const content = {
      ...INPUT.content,
      evil: true,
      sections: [{ ...INPUT.content.sections[0], lineIndices: [1] }],
    } as unknown as ResumeContent;

    await saveResume(db.client, USER, { ...INPUT, content });

    expect(JSON.stringify(updateArgs().content)).not.toMatch(/evil|lineIndices/);
  });

  describe("a version 1 resume (RE-REQ-095)", () => {
    const V1 = { ...CURRENT, schema_version: 1, resume_path: "resumes/u/cv.pdf" };

    it("upgrades first, and sends the caller to read the result", async () => {
      db.queue("resumes", { data: V1, error: null });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });

      expect(await saveResume(db.client, USER, INPUT)).toMatchObject({ ok: false, code: RESUME_CHANGED });

      expect(upgradeResumeFromFile).toHaveBeenCalledWith(V1);
      expect(updateCall()).toBeUndefined();
    });

    it("stops when the upgrade fails", async () => {
      db.queue("resumes", { data: V1, error: null });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "Upload it again." });

      expect(await saveResume(db.client, USER, INPUT)).toEqual({ ok: false, code: "UPGRADE_FAILED", error: "Upload it again." });
      expect(updateCall()).toBeUndefined();
    });
  });

  describe("re-embedding and new matches (RE-REQ-034)", () => {
    const primary = { ...CURRENT, is_primary: true };

    it("refreshes the embedding and matches when the primary's experience changed", async () => {
      seed(primary);
      await saveResume(db.client, USER, { ...INPUT, content: contentWith("Shipped the billing API") });

      expect(refreshProfileAfterChange).not.toHaveBeenCalled();
      await flushAfter();
      expect(refreshProfileAfterChange).toHaveBeenCalledWith(USER.id);
    });

    it("doesn't when only other sections changed", async () => {
      seed({ ...primary, content: contentWith("MIT", "education") });
      await saveResume(db.client, USER, { ...INPUT, content: contentWith("Stanford", "education") });

      await flushAfter();
      expect(refreshProfileAfterChange).not.toHaveBeenCalled();
    });

    it("doesn't when the text is the same", async () => {
      seed(primary);
      await saveResume(db.client, USER, { ...INPUT, name: "Renamed" });

      await flushAfter();
      expect(refreshProfileAfterChange).not.toHaveBeenCalled();
    });

    it("doesn't for a resume that isn't primary", async () => {
      seed();
      await saveResume(db.client, USER, { ...INPUT, content: contentWith("Shipped the billing API") });

      await flushAfter();
      expect(refreshProfileAfterChange).not.toHaveBeenCalled();
    });
  });

  it("records resume_saved with the surface and no text", async () => {
    seed();
    await saveResume(db.client, USER, INPUT, { surface: "agent" });
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.ResumeSaved,
      distinctId: USER.id,
      properties: { surface: "agent" },
    });
  });
});
