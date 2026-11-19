import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { parseCandidateResume } from "@/helpers/candidates/parse-candidate-resume";
import { requeueScreenings } from "@/helpers/matching/queue-screenings";
import { extractResumeText } from "@/helpers/resume/extract-text";
import { storeBoardResume } from "./store-board-resume";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn(async (l: string[]) => l) }));
vi.mock("@/helpers/matching/queue-screenings", () => ({ requeueScreenings: vi.fn() }));
vi.mock("@/helpers/candidates/parse-candidate-resume", () => ({ parseCandidateResume: vi.fn() }));
vi.mock("@/helpers/resume/extract-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume/extract-text")>()),
  extractResumeText: vi.fn(),
}));

const COMPANY = "c0000000-0000-4000-8000-0000000000c1";
const CANDIDATE = "d0000000-0000-4000-8000-0000000000d1";
const PDF = Buffer.from("%PDF-1.7 resume").toString("base64");

let admin: SupabaseMock;
let upload: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  upload = vi.fn(async () => ({ data: {}, error: null }));
  remove = vi.fn(async () => ({ data: [], error: null }));
  Object.assign(admin.client, { storage: { from: () => ({ upload, remove }) } });
  vi.mocked(extractResumeText).mockResolvedValue({ lines: ["Ada Lovelace"] } as never);
  vi.mocked(parseCandidateResume).mockResolvedValue({
    ok: true,
    fields: { current_title: "Engineer", location: "Bengaluru" },
    resume: { sections: [] },
    warnings: [],
  } as never);
});

const run = (base64 = PDF) => storeBoardResume(admin.client, { companyId: COMPANY, candidateId: CANDIDATE, base64 });
const attachArgs = () => admin.callsFor("attach_board_resume")[0].chain[0].args[1] as Record<string, unknown>;

describe("storeBoardResume (MPT-031)", () => {
  it("stores the file under the candidate's folder, attaches the parsed resume and screens again", async () => {
    admin.queueRpc("attach_board_resume", {
      data: { ok: true, company_id: COMPANY, applications: [{ id: "a1", job_post_id: "j1" }] },
      error: null,
    });
    expect(await run()).toBe("attached");
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^${COMPANY}/candidates/${CANDIDATE}/[0-9a-f-]{36}\\.pdf$`));
    expect(attachArgs()).toMatchObject({
      p_candidate_id: CANDIDATE,
      p_path: path,
      p_content: { sections: [] },
      p_fields: { current_title: "Engineer", location: "Bengaluru" },
    });
    expect(requeueScreenings).toHaveBeenCalledWith(admin.client, {
      companyId: COMPANY,
      applications: [{ id: "a1", job_post_id: "j1" }],
      requestedBy: null,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("skips a file that isn't a PDF or DOCX, or is empty", async () => {
    expect(await run(Buffer.from("plain text").toString("base64"))).toBe("skipped");
    expect(await run("")).toBe("skipped");
    expect(upload).not.toHaveBeenCalled();
  });

  it("attaches the file unparsed when the parser fails", async () => {
    vi.mocked(parseCandidateResume).mockRejectedValue(new Error("model down"));
    admin.queueRpc("attach_board_resume", { data: { ok: true, applications: [] }, error: null });
    expect(await run()).toBe("attached");
    expect(attachArgs()).toMatchObject({ p_content: null, p_fields: {} });
  });

  it("keeps the candidate's own resume and deletes the new file", async () => {
    admin.queueRpc("attach_board_resume", { data: { ok: false, reason: "has_resume" }, error: null });
    expect(await run()).toBe("has_resume");
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
    expect(requeueScreenings).not.toHaveBeenCalled();
  });

  it("fails without attaching when the upload fails", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "nope" } });
    expect(await run()).toBe("failed");
    expect(admin.callsFor("attach_board_resume")).toHaveLength(0);
  });
});
