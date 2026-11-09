import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type MockResponse, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("server-only", () => ({}));

const USER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";

let db: SupabaseMock;
let list: ReturnType<typeof vi.fn>;

const run = () =>
  GET(buildRequest("/api/updates/resumes/reparse/enqueue", { headers: { "X-Internal-Secret": "test-secret" } }));

const inserted = () =>
  db
    .callsFor("resume_migration_items")
    .flatMap((c) => c.chain)
    .filter((m) => m.method === "upsert")
    .flatMap((m) => m.args[0] as Record<string, unknown>[]);

const queued = () => db.callsFor("send").map((c) => (c.chain[0].args[1] as { message: { item_id: string } }).message);

const markedQueued = () =>
  db
    .callsFor("resume_migration_items")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

const listResult = (folders: { name: string; id: string | null }[], files: Record<string, { name: string; id: string | null }[]>) =>
  (path: string, options?: { offset?: number }) => ({
    data: (path === "resumes" ? folders : (files[path] ?? [])).slice(options?.offset ?? 0),
    error: null,
  });

const rangeStart = (call: RecordedCall) => Number(call.chain.find((m) => m.method === "range")?.args[0] ?? 0);

/** A table that hands out `rows` a page at a time, capped like PostgREST's max_rows. */
function pagedResumes(rows: unknown[], cap: number) {
  for (let i = 0; i < 20; i++) {
    db.queue("resumes", (call) => {
      const from = rangeStart(call);
      return { data: rows.slice(from, from + cap), error: null };
    });
  }
}

/**
 * `resume_migration_items` is read, upserted and updated in one run. Each call
 * gets the same chain-aware answer, so the run's order or number of writes
 * doesn't matter.
 */
function queueItemTable(responses: { selectFilePaths?: unknown[]; selectPending?: unknown[] } = {}) {
  const answer = (call: RecordedCall): MockResponse => {
    const first = call.chain[0]?.method;
    if (first === "upsert" || first === "update") return { data: null, error: null };
    const selected = String(call.chain.find((m) => m.method === "select")?.args[0] ?? "");
    // `select("file_path")` is the known-paths read; the pending read names `id`.
    const rows = (selected.includes("id") ? responses.selectPending : responses.selectFilePaths) ?? [];
    return { data: rows.slice(rangeStart(call)), error: null };
  };
  for (let i = 0; i < 10; i++) db.queue("resume_migration_items", answer);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  list = vi.fn().mockImplementation(listResult([], {}));
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...db.client,
    storage: { from: () => ({ list, download: vi.fn(), remove: vi.fn() }) },
  } as never);
});

describe("GET /api/updates/resumes/reparse/enqueue (RE-REQ-091/092)", () => {
  it("401s with a wrong secret, and reads nothing", async () => {
    const response = await GET(
      buildRequest("/api/updates/resumes/reparse/enqueue", { headers: { "X-Internal-Secret": "nope" } }),
    );

    expect(response.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("creates one item per resume with a file, and queues it", async () => {
    db.queue("resumes", {
      data: [
        { id: "r1", user_id: USER, resume_path: "resumes/a/1-cv.pdf" },
        { id: "r2", user_id: USER, resume_path: "resumes/a/2-cv.pdf" },
      ],
      error: null,
    });
    queueItemTable({ selectPending: [{ id: "m1", file_path: "resumes/a/1-cv.pdf" }] });
    list.mockImplementation(listResult([], {}));

    const response = await run();
    const body = await response.json();

    expect(body).toMatchObject({ success: true, created: 2, queued: 1 });
    expect(inserted()).toEqual([
      { resume_id: "r1", user_id: USER, file_path: "resumes/a/1-cv.pdf" },
      { resume_id: "r2", user_id: USER, file_path: "resumes/a/2-cv.pdf" },
    ]);
    expect(queued()).toEqual([{ item_id: "m1" }]);
    expect(markedQueued()[0]).toHaveProperty("queued_at");
  });

  it("does not create an item twice for a file it already knows", async () => {
    db.queue("resumes", { data: [{ id: "r1", user_id: USER, resume_path: "resumes/a/1-cv.pdf" }], error: null });
    queueItemTable({ selectFilePaths: [{ file_path: "resumes/a/1-cv.pdf" }] });

    const body = await (await run()).json();

    expect(body.created).toBe(0);
    expect(inserted()).toEqual([]);
  });

  it("records an orphaned file from the bucket, from the owner in its path", async () => {
    db.queue("resumes", { data: [], error: null });
    queueItemTable();
    list.mockImplementation(
      listResult([{ name: USER, id: null }], { [`resumes/${USER}`]: [{ name: "3-cv.pdf", id: "obj" }] }),
    );

    await run();

    const rows = inserted();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resume_id: null, user_id: USER, file_path: `resumes/${USER}/3-cv.pdf` });
  });

  it("reads past max_rows, so a resume beyond the cap isn't recorded as an orphan", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `r${n}`, user_id: USER, resume_path: `resumes/${USER}/${n}-cv.pdf` }));
    pagedResumes(rows, 2);
    queueItemTable();
    list.mockImplementation(
      listResult([{ name: USER, id: null }], {
        [`resumes/${USER}`]: rows.map((row, i) => ({ name: `${i + 1}-cv.pdf`, id: row.id })),
      }),
    );

    await run();

    expect(inserted().map((row) => row.resume_id)).toEqual(["r1", "r2", "r3"]);
  });

  it("lists every page of the bucket", async () => {
    db.queue("resumes", { data: [], error: null });
    queueItemTable();
    const files = [1, 2, 3].map((n) => ({ name: `${n}-cv.pdf`, id: `o${n}` }));
    list.mockImplementation((path: string, options?: { offset?: number }) => {
      const entries = path === "resumes" ? [{ name: USER, id: null }] : files;
      const from = options?.offset ?? 0;
      return { data: entries.slice(from, from + 2), error: null };
    });

    await run();

    expect(inserted()).toHaveLength(3);
  });

  it("skips a bucket file whose path has no owner, rather than guessing one", async () => {
    db.queue("resumes", { data: [], error: null });
    queueItemTable();
    list.mockImplementation(listResult([{ name: "not-a-uuid", id: null }], { "resumes/not-a-uuid": [{ name: "x.pdf", id: "obj" }] }));

    await run();

    expect(inserted()).toEqual([]);
  });

  it("sends an item once: a second run finds it queued and sends nothing", async () => {
    db.queue("resumes", { data: [{ id: "r1", user_id: USER, resume_path: "resumes/a/1-cv.pdf" }], error: null });
    // The pending query only returns rows with no queued_at, so the second run sees none.
    queueItemTable({ selectFilePaths: [{ file_path: "resumes/a/1-cv.pdf" }] });
    list.mockImplementation(listResult([], {}));

    await run();

    expect(queued()).toEqual([]);
  });

  it("still records the rest when one queue send fails", async () => {
    db.queue("resumes", { data: [], error: null });
    queueItemTable({
      selectPending: [
        { id: "m1", file_path: "resumes/a/1.pdf" },
        { id: "m2", file_path: "resumes/a/2.pdf" },
      ],
    });
    db.queueRpc("send", { data: null, error: new Error("queue down") }, "pgmq_public");
    db.queueRpc("send", { data: null, error: null }, "pgmq_public");
    list.mockImplementation(listResult([], {}));

    const body = await (await run()).json();

    expect(body.queued).toBe(1);
    expect(markedQueued()).toHaveLength(1);
  });

  it("emails a status line, and no user", async () => {
    db.queue("resumes", { data: [], error: null });
    queueItemTable();
    list.mockImplementation(listResult([], {}));

    await run();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("RESUME REPARSE ENQUEUE");
  });

  it("500s when a read fails", async () => {
    db.queue("resumes", { data: null, error: new Error("boom") });

    expect((await run()).status).toBe(500);
  });

  it("leaves another user's resume alone, since every item keeps its own owner", async () => {
    db.queue("resumes", {
      data: [
        { id: "r1", user_id: USER, resume_path: "resumes/a/1.pdf" },
        { id: "r2", user_id: OTHER, resume_path: "resumes/b/2.pdf" },
      ],
      error: null,
    });
    queueItemTable();
    list.mockImplementation(listResult([], {}));

    await run();

    expect(inserted().map((row) => row.user_id)).toEqual([USER, OTHER]);
  });
});
