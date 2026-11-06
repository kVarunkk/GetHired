import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendResumeReuploadEmail } from "@/helpers/resume/send-reupload-email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type MockResponse, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/resume/send-reupload-email", () => ({ sendResumeReuploadEmail: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const USER = "a0000000-0000-4000-8000-000000000001";
const ITEM = "f1000000-0000-4000-8000-000000000001";
const PATH = `resumes/${USER}/1-cv.pdf`;

let db: SupabaseMock;
let remove: ReturnType<typeof vi.fn>;

const run = (headers: Record<string, string> = { "X-Internal-Secret": "test-secret" }) =>
  GET(buildRequest("/api/updates/resumes/delete-files", { headers }));

const items = (status: string, overrides: Record<string, unknown> = {}) => [
  { id: ITEM, resume_id: "r1", user_id: USER, file_path: PATH, status, notified_at: null, ...overrides },
];

/**
 * `resume_migration_items`, as one queue of reads per status: each read of a
 * status takes the next page, and a status with no page left is empty. Writes
 * always report success. One responder covers every call, so a write can't
 * consume a page meant for a read.
 */
function queueItems(byStatus: Record<string, unknown[][]>) {
  const pages: Record<string, unknown[][]> = {};
  for (const [status, all] of Object.entries(byStatus)) pages[status] = [...all];

  const answer = (call: RecordedCall): MockResponse => {
    if (call.chain.some((m) => m.method === "update")) return { data: null, error: null };
    const wanted = call.chain.find((m) => m.method === "eq" && m.args[0] === "status")?.args[1] as string;
    return { data: pages[wanted]?.shift() ?? [], error: null };
  };
  for (let i = 0; i < 50; i++) db.queue("resume_migration_items", answer);
}

const updates = () =>
  db
    .callsFor("resume_migration_items")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  remove = vi.fn().mockResolvedValue({ data: null, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...db.client,
    storage: { from: () => ({ remove, download: vi.fn(), list: vi.fn() }) },
  } as never);
  vi.mocked(sendResumeReuploadEmail).mockResolvedValue(true);
  vi.stubEnv("RESUME_FILE_DELETION_ENABLED", "true");
  db.queue("user_info", { data: { email: "ada@applicant.test" }, error: null });
  db.queue("resumes", { data: { name: "Backend" }, error: null });
});

describe("GET /api/updates/resumes/delete-files (RE-REQ-098)", () => {
  it("401s without the secret", async () => {
    expect((await run({})).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("does nothing at all while the switch is off", async () => {
    vi.stubEnv("RESUME_FILE_DELETION_ENABLED", "");

    const body = await (await run()).json();

    expect(body).toEqual({ enabled: false, deleted: 0, notified: 0 });
    expect(db.calls).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes parsed files, and marks each item", async () => {
    queueItems({ parsed: [items("parsed")] });

    const body = await (await run()).json();

    expect(body).toMatchObject({ enabled: true, deleted: 1 });
    expect(remove).toHaveBeenCalledWith([PATH]);
    expect(updates()[0]).toHaveProperty("file_deleted_at");
  });

  it("emails a failed file's user once, then deletes only after the grace period", async () => {
    // First the notify pass, then the ripe (older than 30 days) pass, which is still empty.
    queueItems({ failed: [items("failed"), []], low_coverage: [[]] });

    const body = await (await run()).json();

    expect(body.notified).toBe(1);
    expect(sendResumeReuploadEmail).toHaveBeenCalledWith("ada@applicant.test", "Backend");
    expect(updates().some((u) => "notified_at" in u)).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes a failed file whose grace period has passed", async () => {
    queueItems({ failed: [[], items("failed", { notified_at: "2026-09-01T00:00:00.000Z" })], low_coverage: [[]] });

    await run();

    expect(remove).toHaveBeenCalledWith([PATH]);
  });

  it("does not start the grace period when the email couldn't be sent", async () => {
    vi.mocked(sendResumeReuploadEmail).mockResolvedValue(false);
    queueItems({ failed: [items("failed")], low_coverage: [[]] });

    await run();

    expect(updates().some((u) => "notified_at" in u)).toBe(false);
  });

  it("only removes paths under resumes/, and still settles the row it skipped", async () => {
    queueItems({
      parsed: [
        [
          { id: ITEM, resume_id: "r1", user_id: USER, file_path: "company-candidate-files/x.pdf", status: "parsed", notified_at: null },
          { id: "m2", resume_id: "r2", user_id: USER, file_path: PATH, status: "parsed", notified_at: null },
        ],
      ],
    });

    await run();

    expect(remove).toHaveBeenCalledWith([PATH]);
    // Only the file that was really removed is marked as gone.
    expect(updates()).toHaveLength(1);
  });

  it("leaves the items alone when the bucket refuses the delete", async () => {
    remove.mockResolvedValue({ data: null, error: new Error("storage down") });
    queueItems({ parsed: [items("parsed")] });

    await run();

    expect(updates()).toEqual([]);
  });

  it("is safe to re-run: the query only reads items with no file_deleted_at", async () => {
    queueItems({ parsed: [[]] });

    await run();

    const read = db.callsFor("resume_migration_items")[0].chain;
    expect(read).toContainEqual({ method: "is", args: ["file_deleted_at", null] });
  });

  it("reads a batch at a time, not the whole table", async () => {
    queueItems({ parsed: [[]] });

    await run();

    expect(db.callsFor("resume_migration_items")[0].chain).toContainEqual({ method: "limit", args: [50] });
  });

  it("sweeps a file whose resume is gone without emailing anyone", async () => {
    // The user deleted the resume, so there's nobody to ask for the file again.
    queueItems({ failed: [items("failed", { resume_id: null })], low_coverage: [[]] });

    await run();

    expect(sendResumeReuploadEmail).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith([PATH]);
  });

  it("500s when a read fails", async () => {
    db.queue("resume_migration_items", { data: null, error: new Error("boom") });

    expect((await run()).status).toBe(500);
  });
});
