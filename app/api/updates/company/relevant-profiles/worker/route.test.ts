import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/profiles/relevant-profiles-utils", () => ({ processJobPostingRelevance: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const JOB_ID = "b0000000-0000-4000-8000-000000000001";
const USER_ID = "c1000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const withSecret = (secret: string | null) =>
  vi.mocked(headers).mockResolvedValue(new Headers(secret ? { "X-Internal-Secret": secret } : {}) as never);

const queueMessages = (messages: unknown[]) =>
  supabase.queueRpc("read", { data: messages, error: null }, "pgmq_public");

const rpcCalls = (fn: string) =>
  supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === fn);

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  withSecret("test-secret");
});

describe("GET /api/updates/company/relevant-profiles/worker", () => {
  it("rejects a missing or wrong secret", async () => {
    withSecret("nope");

    expect((await GET()).status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  it("reads a batch with a visibility timeout longer than one run, so the per-minute schedule doesn't run it twice", async () => {
    queueMessages([]);

    await GET();

    expect(rpcCalls("read")[0].chain[0].args[1]).toEqual({
      queue_name: "relevance_profiles",
      sleep_seconds: 300,
      n: 5,
    });
  });

  it("matches each queued job and deletes the message when it succeeds", async () => {
    queueMessages([{ msg_id: 7, read_ct: 1, message: { userId: USER_ID, jobId: JOB_ID } }]);
    vi.mocked(processJobPostingRelevance).mockResolvedValue({ success: true });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(processJobPostingRelevance).toHaveBeenCalledWith(USER_ID, JOB_ID, true);
    expect(rpcCalls("delete")[0].chain[0].args[1]).toEqual({
      queue_name: "relevance_profiles",
      message_id: 7,
    });
  });

  it("leaves a failed message for a retry, and gives up after 3 reads", async () => {
    queueMessages([
      { msg_id: 1, read_ct: 1, message: { userId: USER_ID, jobId: JOB_ID } },
      { msg_id: 2, read_ct: 3, message: { userId: USER_ID, jobId: JOB_ID } },
    ]);
    vi.mocked(processJobPostingRelevance).mockResolvedValue({ success: false, error: "rerank down" });

    await GET();

    const deleted = rpcCalls("delete").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);
    expect(deleted).toEqual([2]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("POISON"));
  });
});
