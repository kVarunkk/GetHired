import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { parseResumeUpload, ResumeParseError } from "@/helpers/resume/parse-resume";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type MockResponse, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/resume/parse-resume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume/parse-resume")>()),
  parseResumeUpload: vi.fn(),
}));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("server-only", () => ({}));

const USER = "a0000000-0000-4000-8000-000000000001";
const ITEM = "f1000000-0000-4000-8000-000000000001";
const RESUME = "f2000000-0000-4000-8000-000000000001";
const PATH = `resumes/${USER}/1-cv.pdf`;

const CONTENT = {
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [{ id: "i1", bullets: [{ id: "new-bullet", text: "Built the billing service" }] }],
    },
  ],
};

const parsed = (overrides: Record<string, unknown> = {}) => ({
  contact: { fullName: "Ada", links: [] },
  content: CONTENT,
  parseNotes: null,
  coverage: 0.95,
  fileType: "pdf" as const,
  fallbackUsed: false,
  ...overrides,
});

let db: SupabaseMock;
let download: ReturnType<typeof vi.fn>;

const run = () =>
  GET(buildRequest("/api/worker/resume-reparse", { headers: { "X-Internal-Secret": "test-secret" } }));

type Item = { status?: string; attempts?: number; resume_id?: string | null; file_path?: string };

/** The item read, then the resume read, then whatever writes it makes. */
function queueItem(item: Item = {}, options: { resume?: unknown; schemaVersion?: number; revision?: number } = {}) {
  const answer = (call: RecordedCall): MockResponse =>
    call.chain[0]?.method === "update"
      ? { data: null, error: null }
      : {
          data: {
            id: ITEM,
            resume_id: "resume_id" in item ? item.resume_id : RESUME,
            user_id: USER,
            file_path: item.file_path ?? PATH,
            status: item.status ?? "pending",
            attempts: item.attempts ?? 0,
          },
          error: null,
        };
  for (let i = 0; i < 10; i++) db.queue("resume_migration_items", answer);

  const resume =
    options.resume === undefined
      ? { id: RESUME, name: "cv.pdf", content: null, schema_version: options.schemaVersion ?? 1, revision: options.revision ?? 1 }
      : options.resume;
  db.queue("resumes", (call) => (call.chain[0]?.method === "update" ? { data: null, error: null } : { data: resume, error: null }));
}

const message = (itemId = ITEM) =>
  db.queueRpc("read", { data: [{ msg_id: 7, read_ct: 1, message: { item_id: itemId } }], error: null }, "pgmq_public");

const itemUpdates = () =>
  db
    .callsFor("resume_migration_items")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

const resumeUpdates = () =>
  db
    .callsFor("resumes")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

const resumeChain = () => db.callsFor("resumes").map((c) => c.chain);
const archived = () => db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...db.client,
    storage: { from: () => ({ download, list: vi.fn(), remove: vi.fn() }) },
  } as never);
  vi.mocked(parseResumeUpload).mockResolvedValue(parsed() as never);
});

describe("GET /api/worker/resume-reparse (RE-REQ-092/093/094)", () => {
  it("401s without the secret", async () => {
    expect((await GET(buildRequest("/api/worker/resume-reparse"))).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("returns without work when the queue is empty", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");

    const body = await (await run()).json();

    expect(body).toEqual({ parsed: 0, failed: 0, retried: 0, skipped: 0 });
  });

  it("parse a pending item, writes the resume guarded by schema_version, and archives", async () => {
    message();
    queueItem();

    const body = await (await run()).json();

    expect(body.parsed).toBe(1);
    expect(parseResumeUpload).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), { fileName: "1-cv.pdf" });
    expect(resumeUpdates()[0]).toMatchObject({
      schema_version: 2,
      contact: { fullName: "Ada", links: [] },
      parsing_failed: false,
      name: "cv",
      revision: 2,
    });
    // Never overwrites one that's already upgraded (RE-REQ-093).
    expect(resumeChain().some((chain) => chain.some((m) => m.method === "eq" && m.args[0] === "schema_version"))).toBe(true);
    expect(itemUpdates()[0]).toMatchObject({ status: "parsed", coverage: 0.95, error: null });
    expect(archived()).toEqual([7]);
  });

  it("keeps the old bullet ids, so existing reviews still point at the text", async () => {
    message();
    queueItem(
      {},
      {
        resume: {
          id: RESUME,
          name: "cv.pdf",
          schema_version: 1,
          revision: 1,
          content: {
            version: 2,
            sections: [
              { id: "s0", type: "experience", items: [{ id: "i0", bullets: [{ id: "old-bullet", text: "Built the billing service" }] }] },
            ],
          },
        },
      },
    );

    await run();

    const written = resumeUpdates()[0].content as { sections: { items: { bullets: { id: string }[] }[] }[] };
    expect(written.sections[0].items[0].bullets[0].id).toBe("old-bullet");
  });

  it("skips an item that isn't pending, without parsing it again", async () => {
    message();
    queueItem({ status: "parsed" });

    const body = await (await run()).json();

    expect(body.skipped).toBe(1);
    expect(parseResumeUpload).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("parses a file whose name has a double dot", async () => {
    message();
    queueItem({ file_path: `resumes/${USER}/1-cv..pdf` });

    const body = await (await run()).json();

    expect(body.parsed).toBe(1);
    expect(parseResumeUpload).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), { fileName: "1-cv..pdf" });
    expect(itemUpdates()[0]).toMatchObject({ status: "parsed" });
  });

  it("never downloads a path with a .. segment", async () => {
    message();
    queueItem({ file_path: `resumes/${USER}/../other/1-cv.pdf` });

    await run();

    expect(download).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("skips an item whose row is gone", async () => {
    message();
    db.queue("resume_migration_items", { data: null, error: null });

    await run();

    expect(parseResumeUpload).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("leaves an already upgraded resume alone and still settles the item", async () => {
    message();
    queueItem({}, { schemaVersion: 2 });

    await run();

    expect(resumeUpdates()).toHaveLength(0);
    expect(itemUpdates()[0]).toMatchObject({ status: "parsed" });
    expect(archived()).toEqual([7]);
  });

  it("fails the item at once when the file can't be read", async () => {
    message();
    queueItem();
    vi.mocked(parseResumeUpload).mockRejectedValue(new ResumeParseError("We couldn't read this file."));

    const body = await (await run()).json();

    expect(body.failed).toBe(1);
    expect(itemUpdates()[0]).toMatchObject({ status: "failed", error: "We couldn't read this file." });
    expect(archived()).toEqual([7]);
    expect(resumeUpdates()).toHaveLength(0);
  });

  it("fails the item when its file is missing from the bucket", async () => {
    message();
    queueItem();
    download.mockResolvedValue({ data: null, error: new Error("not found") });

    await run();

    expect(parseResumeUpload).not.toHaveBeenCalled();
    expect(itemUpdates()[0]).toMatchObject({ status: "failed" });
    expect(archived()).toEqual([7]);
  });

  it("treats Storage's 400 with a 404 statusCode as a missing file", async () => {
    message();
    queueItem();
    download.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Object gone"), { status: 400, statusCode: "404" }),
    });

    await run();

    expect(itemUpdates()[0]).toMatchObject({ status: "failed" });
    expect(archived()).toEqual([7]);
  });

  it("retries a storage outage rather than asking the user to upload again", async () => {
    message();
    queueItem();
    download.mockResolvedValue({ data: null, error: new Error("gateway timeout") });

    const body = await (await run()).json();

    expect(body.retried).toBe(1);
    expect(itemUpdates()[0]).toEqual(expect.objectContaining({ attempts: 1 }));
    expect(itemUpdates()[0]).not.toHaveProperty("status");
    expect(archived()).toEqual([]);
  });

  it("fails the item once a storage outage outlasts the attempts", async () => {
    message();
    queueItem({ attempts: 2 });
    download.mockResolvedValue({ data: null, error: new Error("gateway timeout") });

    const body = await (await run()).json();

    expect(body.failed).toBe(1);
    expect(archived()).toEqual([7]);
  });

  it("never settles an item when the resume read fails, because parsed lets its file be deleted", async () => {
    message();
    db.queue("resumes", { data: null, error: new Error("db down") });
    queueItem();

    const body = await (await run()).json();

    expect(body.retried).toBe(1);
    expect(itemUpdates().some((update) => update.status === "parsed")).toBe(false);
    expect(archived()).toEqual([]);
  });

  it("upgrades a resume whose item was recorded with no resume_id, rather than treating it as an orphan", async () => {
    message();
    queueItem({ resume_id: null });

    await run();

    expect(resumeChain()[0]).toContainEqual({ method: "eq", args: ["resume_path", PATH] });
    expect(resumeUpdates()[0]).toMatchObject({ schema_version: 2 });
    expect(itemUpdates()[0]).toMatchObject({ status: "parsed", resume_id: RESUME });
  });

  it("returns a provider error for a retry, without archiving it", async () => {
    message();
    queueItem({ attempts: 0 });
    vi.mocked(parseResumeUpload).mockRejectedValue(new Error("429 rate limited"));

    const body = await (await run()).json();

    expect(body.retried).toBe(1);
    expect(itemUpdates()[0]).toMatchObject({ attempts: 1 });
    expect(itemUpdates()[0]).not.toHaveProperty("status");
    expect(archived()).toEqual([]);
  });

  it("gives up after the maximum attempts and fails the item", async () => {
    message();
    queueItem({ attempts: 2 });
    vi.mocked(parseResumeUpload).mockRejectedValue(new Error("429 rate limited"));

    await run();

    expect(itemUpdates()[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(archived()).toEqual([7]);
  });

  it("marks a low-coverage parse, so the user is asked to upload again", async () => {
    message();
    queueItem();
    vi.mocked(parseResumeUpload).mockResolvedValue(parsed({ coverage: 0.4 }) as never);

    await run();

    expect(itemUpdates()[0]).toMatchObject({ status: "low_coverage", coverage: 0.4 });
    expect(itemUpdates()[0]).not.toHaveProperty("notified_at");
  });

  it("treats a file sent to the model directly as parsed, since it has no coverage to judge", async () => {
    message();
    queueItem();
    vi.mocked(parseResumeUpload).mockResolvedValue(parsed({ coverage: null, fallbackUsed: true }) as never);

    await run();

    expect(itemUpdates()[0]).toMatchObject({ status: "parsed", coverage: null });
  });

  it("settles an orphan item whose resume is gone, so its file can be swept", async () => {
    message();
    queueItem({ resume_id: null }, { resume: null });

    const body = await (await run()).json();

    expect(body.parsed).toBe(1);
    expect(resumeUpdates()).toHaveLength(0);
    expect(itemUpdates()[0]).toMatchObject({ status: "parsed" });
  });

  it("charges no credits and emails no user on success", async () => {
    message();
    queueItem();

    await run();

    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
    expect(db.callsFor("user_info")).toHaveLength(0);
    expect(db.callsFor("deduct_user_credits")).toHaveLength(0);
  });

  it("emails a status line only when something failed", async () => {
    message();
    queueItem();
    vi.mocked(parseResumeUpload).mockRejectedValue(new ResumeParseError("We couldn't read this file."));

    await run();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain(PATH);
  });

  it("500s when the queue can't be read", async () => {
    db.queueRpc("read", { data: null, error: new Error("down") }, "pgmq_public");

    expect((await run()).status).toBe(500);
  });
});
