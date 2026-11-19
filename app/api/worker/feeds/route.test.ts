import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadFeedJobs } from "@/helpers/distribution/feeds/load-feed-jobs";
import { FEED_REBUILD_MAX_READS } from "@/helpers/distribution/feed-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/distribution/feeds/load-feed-jobs", () => ({ loadFeedJobs: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

let db: SupabaseMock;
const upload = vi.fn();
const run = () => GET(buildRequest("/api/worker/feeds", { headers: { "X-Internal-Secret": "test-secret" } }));
const archived = () => db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  upload.mockResolvedValue({ data: {}, error: null });
  (db.client as unknown as { storage: unknown }).storage = { from: () => ({ upload }) };
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(loadFeedJobs).mockResolvedValue([]);
});

describe("GET /api/worker/feeds", () => {
  it("401s without the secret", async () => {
    expect((await GET(buildRequest("/api/worker/feeds"))).status).toBe(401);
  });

  it("does nothing on an empty queue", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");
    expect(await (await run()).json()).toEqual({ rebuilt: 0, failed: 0 });
    expect(loadFeedJobs).not.toHaveBeenCalled();
  });

  it("coalesces many messages into one rebuild per platform", async () => {
    db.queueRpc("read", { data: [1, 2, 3].map((msg_id) => ({ msg_id, read_ct: 1 })), error: null }, "pgmq_public");
    expect(await (await run()).json()).toEqual({ rebuilt: 4, failed: 0 });
    expect(loadFeedJobs).toHaveBeenCalledTimes(4);
    expect(upload.mock.calls.map((c) => c[0])).toEqual(["jooble.xml", "adzuna.xml", "talent.xml", "ziprecruiter.xml"]);
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: true });
    expect(archived()).toEqual([1, 2, 3]);
  });

  it("keeps the messages for a retry when a rebuild fails", async () => {
    db.queueRpc("read", { data: [{ msg_id: 1, read_ct: 1 }], error: null }, "pgmq_public");
    vi.mocked(loadFeedJobs).mockRejectedValueOnce(new Error("boom"));
    expect((await (await run()).json()).failed).toBe(1);
    expect(archived()).toEqual([]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("treats a failed upload as a failed rebuild", async () => {
    db.queueRpc("read", { data: [{ msg_id: 1, read_ct: 1 }], error: null }, "pgmq_public");
    upload.mockResolvedValue({ data: null, error: { message: "bucket missing" } });
    expect((await (await run()).json()).failed).toBe(4);
    expect(archived()).toEqual([]);
  });

  it("gives up once, archiving and emailing", async () => {
    db.queueRpc("read", { data: [{ msg_id: 1, read_ct: FEED_REBUILD_MAX_READS }], error: null }, "pgmq_public");
    vi.mocked(loadFeedJobs).mockRejectedValueOnce(new Error("boom"));
    await run();
    expect(archived()).toEqual([1]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
  });
});
