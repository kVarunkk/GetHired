import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const NOW = new Date("2026-10-20T03:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const OWNER = "c1000000-0000-4000-8000-000000000001";
const job = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `b0000000-0000-4000-8000-00000000000${n}`,
  matched_at: ago(7 * 24 * 60),
  matching_status: "completed",
  updated_at: ago(7 * 24 * 60),
  company_info: { user_id: OWNER },
  ...overrides,
});

let supabase: SupabaseMock;

const withSecret = (secret: string) =>
  vi.mocked(headers).mockResolvedValue(new Headers({ "X-Internal-Secret": secret }) as never);

/** The latest profile change: one query by updated_at, one by embedding_updated_at. */
function queueLatestProfileChange(updatedAt: string | null, embeddedAt: string | null = null) {
  supabase.queue("user_info", { data: updatedAt ? [{ updated_at: updatedAt }] : [], error: null });
  supabase.queue("user_info", {
    data: embeddedAt ? [{ embedding_updated_at: embeddedAt }] : [],
    error: null,
  });
}

const sends = () =>
  supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === "send_batch");

const statusUpdates = (status: string) =>
  supabase
    .callsFor("job_postings")
    .filter((c) => c.chain.some((m) => m.method === "update" && (m.args[0] as { matching_status?: string }).matching_status === status));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  withSecret("test-secret");
  return () => vi.useRealTimers();
});

describe("GET /api/updates/company/relevant-profiles/enqueue", () => {
  it("rejects a wrong secret", async () => {
    withSecret("nope");

    expect((await GET()).status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  it("only reads candidates who are visible to companies and finished onboarding", async () => {
    queueLatestProfileChange(null);
    supabase.queue("job_postings", { data: [], error: null });

    await GET();

    for (const call of supabase.callsFor("user_info")) {
      expect(call.chain).toContainEqual({ method: "eq", args: ["is_public", true] });
      expect(call.chain).toContainEqual({ method: "eq", args: ["filled", true] });
    }
  });

  it("queues the active jobs matched before the latest profile change, or never matched, and marks them in progress", async () => {
    queueLatestProfileChange(ago(60), ago(30));
    supabase.queue("job_postings", {
      data: [
        job(1), // matched a week ago: stale
        job(2, { matched_at: ago(10) }), // matched after the latest change: fresh
        job(3, { matched_at: null }), // never matched
        job(4, { matching_status: "progress", updated_at: ago(5) }), // running now
        job(5, { matching_status: "progress", updated_at: ago(60), matched_at: ago(120) }), // stuck: retried
      ],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, queued: 3 });
    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["status", "active"],
    });
    const ids = ["b0000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000003", "b0000000-0000-4000-8000-000000000005"];
    expect(sends()[0].chain[0].args[1]).toEqual({
      queue_name: "relevance_profiles",
      messages: ids.map((jobId) => ({ userId: OWNER, jobId })),
      sleep_seconds: 0,
    });
    const [progress] = statusUpdates("progress");
    expect(progress.chain).toContainEqual({ method: "in", args: ["id", ids] });
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("uses the newer of updated_at and embedding_updated_at as the latest change", async () => {
    queueLatestProfileChange(ago(600), ago(5));
    supabase.queue("job_postings", { data: [job(1, { matched_at: ago(10) })], error: null });

    expect(await (await GET()).json()).toMatchObject({ queued: 1 });
  });

  it("answers 200 and sends nothing when every job is up to date", async () => {
    queueLatestProfileChange(ago(600));
    supabase.queue("job_postings", { data: [job(1, { matched_at: ago(10) })], error: null });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, queued: 0 });
    expect(sends()).toHaveLength(0);
    expect(statusUpdates("progress")).toHaveLength(0);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("answers 200 when there are no active jobs or no candidates", async () => {
    queueLatestProfileChange(null);
    supabase.queue("job_postings", { data: [job(1)], error: null });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(sends()).toHaveLength(0);
  });

  it("marks the jobs failed and alerts when the messages can't be sent", async () => {
    queueLatestProfileChange(ago(60));
    supabase.queue("job_postings", { data: [job(1)], error: null });
    supabase.queueRpc("send_batch", { data: null, error: { message: "queue down" } }, "pgmq_public");

    const res = await GET();

    expect(res.status).toBe(500);
    expect(statusUpdates("failed")).toHaveLength(1);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("queue down"));
  });
});
