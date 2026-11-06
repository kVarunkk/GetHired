import { beforeEach, describe, expect, it, vi } from "vitest";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { ResumeParseError, parseResumeUpload, type ParsedResumeUpload } from "@/helpers/resume/parse-resume";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { RESUME_UPGRADE_FAILED_ERROR, upgradeResume, upgradeResumeFromFile } from "./upgrade-resume";

vi.mock("@/helpers/resume/parse-resume", async (original) => ({
  ...(await original<typeof import("@/helpers/resume/parse-resume")>()),
  parseResumeUpload: vi.fn(),
}));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/send-resume-status-email", () => ({ sendResumeParsingStatusEmail: vi.fn() }));

const PARSED: ParsedResumeUpload = {
  contact: { fullName: "Ada", links: [] },
  content: {
    version: 2,
    sections: [
      {
        id: "s-new",
        type: "experience",
        items: [{ id: "i-new", bullets: [{ id: "b-new", text: "Built the billing API" }] }],
      },
    ],
  },
  parseNotes: null,
  coverage: 1,
  fileType: "pdf",
  fallbackUsed: false,
};

const OLD = {
  id: "r1",
  name: "cv.pdf",
  revision: 3,
  content: { sections: [{ type: "experience", items: [{ bullets: [{ id: "b-old", text: "Built the billing API" }] }] }] },
};

const FILE = { bytes: new Uint8Array([1, 2]), fileName: "cv.pdf" };

let admin: SupabaseMock;

const update = () =>
  admin.callsFor("resumes")[0].chain.find((c) => c.method === "update")!.args[0] as {
    content: ParsedResumeUpload["content"];
    [key: string]: unknown;
  };

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(parseResumeUpload).mockResolvedValue(PARSED);
});

describe("upgradeResume (RE-REQ-093)", () => {
  it("writes version 2, keeping the old bullet's id", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });

    expect(await upgradeResume(admin.client, OLD, FILE)).toEqual({ ok: true, upgraded: true, coverage: 1 });

    expect(update()).toMatchObject({ schema_version: 2, contact: PARSED.contact, parsing_failed: false });
    expect(update().content.sections[0].items[0].bullets[0].id).toBe("b-old");
  });

  it("only writes where the resume is still version 1", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });
    await upgradeResume(admin.client, OLD, FILE);

    const { chain } = admin.callsFor("resumes")[0];
    expect(chain).toContainEqual({ method: "eq", args: ["schema_version", 1] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", "r1"] });
  });

  it("changes nothing on a second run", async () => {
    admin.queue("resumes", { data: null, error: null });

    expect(await upgradeResume(admin.client, OLD, FILE)).toEqual({ ok: true, upgraded: false, coverage: 1 });
  });

  it("raises the revision, so a holder of the old text has to read again", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });
    await upgradeResume(admin.client, OLD, FILE);
    expect(update().revision).toBe(4);
  });

  it("drops .pdf from a name that's still the file's", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });
    await upgradeResume(admin.client, OLD, FILE);
    expect(update().name).toBe("cv");
  });

  it("leaves a name the user chose", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });
    await upgradeResume(admin.client, { ...OLD, name: "Backend roles" }, FILE);
    expect(update()).not.toHaveProperty("name");
  });

  it("handles a resume with no content", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });

    expect(await upgradeResume(admin.client, { ...OLD, content: null }, FILE)).toMatchObject({ ok: true });
    expect(update().content.sections[0].items[0].bullets[0].id).toBe("b-new");
  });

  it("charges no credits", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });
    await upgradeResume(admin.client, OLD, FILE);
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("writes nothing when the parse fails", async () => {
    vi.mocked(parseResumeUpload).mockRejectedValue(new ResumeParseError("We couldn't read this file."));

    expect(await upgradeResume(admin.client, OLD, FILE)).toEqual({ ok: false, error: "We couldn't read this file." });
    expect(admin.callsFor("resumes")).toHaveLength(0);
  });
});

describe("upgradeResumeFromFile (RE-REQ-095)", () => {
  let download: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(4)]), error: null });
    Object.assign(admin.client, { storage: { from: () => ({ download }) } });
    vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  });

  it("reads the stored file and upgrades", async () => {
    admin.queue("resumes", { data: { id: "r1" }, error: null });

    expect(await upgradeResumeFromFile({ ...OLD, resume_path: "resumes/u/1-cv.pdf" })).toMatchObject({ ok: true, upgraded: true });

    expect(download).toHaveBeenCalledWith("resumes/u/1-cv.pdf");
    expect(vi.mocked(parseResumeUpload).mock.calls[0][1]).toEqual({ fileName: "1-cv.pdf" });
  });

  it("fails without a file", async () => {
    expect(await upgradeResumeFromFile({ ...OLD, resume_path: null })).toEqual({ ok: false, error: RESUME_UPGRADE_FAILED_ERROR });
  });

  it("fails when the download does", async () => {
    download.mockResolvedValue({ data: null, error: { message: "gone" } });
    expect(await upgradeResumeFromFile({ ...OLD, resume_path: "p" })).toEqual({ ok: false, error: RESUME_UPGRADE_FAILED_ERROR });
  });

  it("offers a re-upload when the parse fails", async () => {
    vi.mocked(parseResumeUpload).mockRejectedValue(new ResumeParseError("We couldn't read this file."));
    expect(await upgradeResumeFromFile({ ...OLD, resume_path: "p" })).toEqual({ ok: false, error: RESUME_UPGRADE_FAILED_ERROR });
  });
});
