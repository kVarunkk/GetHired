import { beforeEach, describe, expect, it, vi } from "vitest";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { ResumeParseError, parseResumeUpload, type ParsedResumeUpload } from "@/helpers/resume/parse-resume";
import { RESUME_MAX_FILE_BYTES, RESUME_MAX_PER_USER } from "@/helpers/resume/config";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PostHogEvent, TAICredits } from "@/utils/types";
import { resumeFromUpload } from "./resume-from-upload";

vi.mock("@/helpers/resume/parse-resume", async (original) => ({
  ...(await original<typeof import("@/helpers/resume/parse-resume")>()),
  parseResumeUpload: vi.fn(),
}));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/send-resume-status-email", () => ({ sendResumeParsingStatusEmail: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const SECRET = "Built the secret engine";

const PARSED: ParsedResumeUpload = {
  contact: { fullName: "Ada", links: [] },
  content: {
    version: 2,
    sections: [
      {
        id: "s1",
        type: "experience",
        items: [{ id: "i1", bullets: [{ id: "b1", text: SECRET }] }],
      },
    ],
  },
  parseNotes: { unusedLines: ["Lost line"] },
  coverage: 0.9,
  fileType: "pdf",
  fallbackUsed: false,
};

const file = (name = "My CV.pdf", size = 10) => new File([new Uint8Array(size)], name);

let db: SupabaseMock;
let storageFrom: ReturnType<typeof vi.fn>;

function seed({ credits = 20, resumes = 1 }: { credits?: number; resumes?: number } = {}) {
  db.queue("user_info", { data: { ai_credits: credits }, error: null });
  db.queue("resumes", { data: null, error: null, count: resumes });
}

const insertOf = (mock: SupabaseMock) =>
  mock.callsFor("resumes").flatMap((call) => call.chain).find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;

const updatesOf = (mock: SupabaseMock) =>
  mock.callsFor("resumes").flatMap((call) => call.chain.filter((c) => c.method === "update").map((c) => c.args[0] as Record<string, unknown>));

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  storageFrom = vi.fn();
  Object.assign(db.client, { storage: { from: storageFrom } });
  vi.mocked(parseResumeUpload).mockResolvedValue(PARSED);
  vi.mocked(deductUserCreditsHelper).mockResolvedValue({ success: true });
  vi.mocked(updateUserEmbedding).mockResolvedValue({ error: null } as never);
});

describe("resumeFromUpload (RE-REQ-010)", () => {
  it("saves the parsed resume, with no file", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    expect(await resumeFromUpload(db.client, USER, file())).toEqual({ ok: true, resumeId: "r1" });

    const insert = insertOf(db);
    expect(insert).toMatchObject({
      user_id: USER.id,
      name: "My CV",
      schema_version: 2,
      content: PARSED.content,
      contact: PARSED.contact,
      parse_notes: PARSED.parseNotes,
      is_primary: false,
    });
    expect(insert).not.toHaveProperty("resume_path");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("passes the bytes and name to the parser", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file("cv.docx", 3));

    const [bytes, options] = vi.mocked(parseResumeUpload).mock.calls[0];
    expect(bytes).toHaveLength(3);
    expect(options).toEqual({ fileName: "cv.docx" });
  });

  it("uses the given name", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file(), { name: "From Acme" });
    expect(insertOf(db).name).toBe("From Acme");
  });

  it("charges after the row is saved", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file());

    expect(deductUserCreditsHelper).toHaveBeenCalledWith(db.client, USER.id, TAICredits.AI_SEARCH_ASK_AI_RESUME);
  });

  it("refuses too few credits before the model runs", async () => {
    seed({ credits: TAICredits.AI_SEARCH_ASK_AI_RESUME - 1 });

    expect(await resumeFromUpload(db.client, USER, file())).toEqual({
      ok: false,
      error: "Insufficient AI credits for resume upload. Please top up to continue.",
    });
    expect(parseResumeUpload).not.toHaveBeenCalled();
    expect(insertOf(db)).toBeUndefined();
  });

  it("refuses a missing profile", async () => {
    db.queue("user_info", { data: null, error: null });
    expect(await resumeFromUpload(db.client, USER, file())).toMatchObject({ ok: false, error: expect.stringMatching(/profile/i) });
  });

  it("refuses an empty file and one over the size limit, before anything else", async () => {
    expect(await resumeFromUpload(db.client, USER, file("a.pdf", 0))).toMatchObject({ ok: false });
    expect(await resumeFromUpload(db.client, USER, file("a.pdf", RESUME_MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      error: "The file must be 2 MB or smaller.",
    });
    expect(db.calls).toHaveLength(0);
    expect(parseResumeUpload).not.toHaveBeenCalled();
  });

  it("leaves no row and no charge when the parse fails, and shows the reason", async () => {
    seed();
    vi.mocked(parseResumeUpload).mockRejectedValue(new ResumeParseError("We couldn't read this file."));

    expect(await resumeFromUpload(db.client, USER, file())).toEqual({ ok: false, error: "We couldn't read this file." });
    expect(insertOf(db)).toBeUndefined();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("charges nothing when the save fails", async () => {
    seed();
    db.queue("resumes", { data: null, error: { message: "db down" } });

    expect(await resumeFromUpload(db.client, USER, file())).toMatchObject({ ok: false });
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("still returns the resume when the charge fails, and reports it", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });
    vi.mocked(deductUserCreditsHelper).mockResolvedValue({ success: false, error: "INTERNAL_ERROR", message: "boom" });

    expect(await resumeFromUpload(db.client, USER, file())).toEqual({ ok: true, resumeId: "r1" });
    expect(reportError).toHaveBeenCalled();
  });

  it("still returns the resume when the charge throws", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });
    vi.mocked(deductUserCreditsHelper).mockRejectedValue(new Error("boom"));

    expect(await resumeFromUpload(db.client, USER, file())).toEqual({ ok: true, resumeId: "r1" });
    expect(reportError).toHaveBeenCalled();
  });

  it("refuses at the resume limit", async () => {
    seed({ resumes: RESUME_MAX_PER_USER });

    expect(await resumeFromUpload(db.client, USER, file())).toMatchObject({ ok: false, error: expect.stringContaining(`up to ${RESUME_MAX_PER_USER} `) });
    expect(parseResumeUpload).not.toHaveBeenCalled();
  });

  it("makes it primary and re-embeds after the response", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file(), { makePrimary: true });

    expect(updatesOf(db)).toEqual([{ is_primary: false }, { is_primary: true }]);
    expect(updateUserEmbedding).not.toHaveBeenCalled();
    await flushAfter();
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER.id);
  });

  it("doesn't re-embed for a resume that isn't primary", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file());
    await flushAfter();
    expect(updateUserEmbedding).not.toHaveBeenCalled();
  });

  describe("replacing a resume", () => {
    const seedReplace = (row: unknown, existing: unknown = { revision: 5 }) => {
      db.queue("user_info", { data: { ai_credits: 20 }, error: null });
      db.queue("resumes", { data: existing, error: null });
      db.queue("resumes", { data: row, error: null });
    };

    it("overwrites that row, for this user, and adds none", async () => {
      seedReplace({ id: "r1", is_primary: false });

      expect(await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "r1" })).toEqual({ ok: true, resumeId: "r1" });

      for (const call of db.callsFor("resumes")) {
        expect(call.chain).toContainEqual({ method: "eq", args: ["id", "r1"] });
        expect(call.chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
      }
      expect(updatesOf(db)[0]).toMatchObject({ schema_version: 2, content: PARSED.content, contact: PARSED.contact, name: "My CV" });
      expect(insertOf(db)).toBeUndefined();
    });

    it("raises the revision it read, so an open editor can't save over the new file", async () => {
      seedReplace({ id: "r1", is_primary: false });

      await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "r1" });

      expect(updatesOf(db)[0]).toMatchObject({ revision: 6 });
      expect(db.callsFor("resumes")[1].chain).toContainEqual({ method: "eq", args: ["revision", 5] });
    });

    it("isn't held back by the limit", async () => {
      seedReplace({ id: "r1", is_primary: false });
      await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "r1" });
      expect(db.callsFor("resumes").flatMap((call) => call.chain).filter((step) => step.method === "select" && (step.args[1] as { head?: boolean } | undefined)?.head)).toHaveLength(0);
    });

    it("fails for a resume that isn't the user's, and charges nothing", async () => {
      seedReplace(null, null);

      expect(await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "other" })).toMatchObject({ ok: false });
      expect(deductUserCreditsHelper).not.toHaveBeenCalled();
    });

    it("fails when a save lands during the parse, and charges nothing", async () => {
      seedReplace(null);

      expect(await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "r1" })).toMatchObject({ ok: false });
      expect(deductUserCreditsHelper).not.toHaveBeenCalled();
    });

    it("re-embeds when the replaced resume is primary", async () => {
      seedReplace({ id: "r1", is_primary: true });

      await resumeFromUpload(db.client, USER, file(), { replaceResumeId: "r1" });
      await flushAfter();
      expect(updateUserEmbedding).toHaveBeenCalledWith(USER.id);
    });
  });

  it("records resume_parsed, with no resume text", async () => {
    seed();
    db.queue("resumes", { data: { id: "r1" }, error: null });

    await resumeFromUpload(db.client, USER, file());
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.ResumeParsed,
      distinctId: USER.id,
      properties: {
        duration_ms: expect.any(Number),
        file_type: "pdf",
        section_count: 1,
        coverage: 0.9,
        fallback_used: false,
      },
    });
    const event = JSON.stringify(vi.mocked(eventCaptureServer).mock.calls);
    expect(event).not.toContain(SECRET);
    expect(event).not.toContain("Lost line");
    expect(event).not.toContain("Ada");
  });
});
