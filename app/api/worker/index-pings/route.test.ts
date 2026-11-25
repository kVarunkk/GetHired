import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { pingGoogleIndexing, pingIndexNow } from "@/helpers/distribution/index-ping";
import { INDEX_PING_MAX_READS, type IndexPingMessage } from "@/helpers/distribution/index-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/distribution/index-ping", async (orig) => ({
  ...(await orig<typeof import("@/helpers/distribution/index-ping")>()),
  pingIndexNow: vi.fn(),
  pingGoogleIndexing: vi.fn(),
}));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

let db: SupabaseMock;

const msg = (msg_id: number, jobId: string, read_ct = 1, reason: IndexPingMessage["reason"] = "updated") => ({
  msg_id,
  read_ct,
  message: { jobId, reason },
});
const job = (jobId: string, over: Record<string, unknown> = {}) => ({
  job_id: jobId,
  status: "active",
  visibility: "public",
  title: "Backend Engineer",
  description: "Build and run the services behind our hiring platform. ".repeat(4),
  location: ["Bengaluru"],
  workplace_type: "onsite",
  company_info: { name: "Acme", logo_url: "https://x/logo.png" },
  ...over,
});
const run = () => GET(buildRequest("/api/worker/index-pings", { headers: { "X-Internal-Secret": "test-secret" } }));
const archived = () => db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(pingIndexNow).mockResolvedValue({ ok: true });
  vi.mocked(pingGoogleIndexing).mockResolvedValue({ ok: true });
});

describe("GET /api/worker/index-pings", () => {
  it("401s without the secret", async () => {
    expect((await GET(buildRequest("/api/worker/index-pings"))).status).toBe(401);
  });

  it("announces an active, eligible job as updated and archives", async () => {
    db.queueRpc("read", { data: [msg(1, "j1")], error: null }, "pgmq_public");
    db.queue("job_postings", { data: [job("j1")], error: null });

    expect(await (await run()).json()).toEqual({ pinged: 1, skipped: 0, failed: 0 });
    expect(pingGoogleIndexing).toHaveBeenCalledWith(expect.stringContaining("/jobs/j1"), "URL_UPDATED");
    expect(archived()).toEqual([1]);
  });

  it("announces a closed or missing job as deleted", async () => {
    db.queueRpc("read", { data: [msg(1, "j1", 1, "closed"), msg(2, "gone")], error: null }, "pgmq_public");
    db.queue("job_postings", { data: [job("j1", { status: "inactive" })], error: null });

    await run();
    expect(vi.mocked(pingGoogleIndexing).mock.calls.map((c) => c[1])).toEqual(["URL_DELETED", "URL_DELETED"]);
  });

  it("announces a link-only job as deleted, never as live (JLT-062)", async () => {
    db.queueRpc("read", { data: [msg(1, "j1")], error: null }, "pgmq_public");
    db.queue("job_postings", { data: [job("j1", { visibility: "link_only" })], error: null });

    await run();
    expect(pingGoogleIndexing).toHaveBeenCalledWith(expect.stringContaining("/jobs/j1"), "URL_DELETED");
  });

  it("does not ping an active job that fails the eligibility checks", async () => {
    db.queueRpc("read", { data: [msg(1, "j1")], error: null }, "pgmq_public");
    db.queue("job_postings", { data: [job("j1", { description: "short" })], error: null });

    expect(await (await run()).json()).toEqual({ pinged: 0, skipped: 1, failed: 0 });
    expect(pingIndexNow).not.toHaveBeenCalled();
    expect(pingGoogleIndexing).not.toHaveBeenCalled();
    expect(archived()).toEqual([1]);
  });

  it("keeps a failed ping queued until the give-up read, then archives and emails once", async () => {
    vi.mocked(pingIndexNow).mockResolvedValue({ ok: false, status: 429 });
    db.queueRpc(
      "read",
      { data: [msg(1, "j1", 1), msg(2, "j2", INDEX_PING_MAX_READS)], error: null },
      "pgmq_public",
    );
    db.queue("job_postings", { data: [job("j1"), job("j2")], error: null });

    expect(await (await run()).json()).toEqual({ pinged: 0, skipped: 0, failed: 1 });
    expect(archived()).toEqual([2]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
  });
});
