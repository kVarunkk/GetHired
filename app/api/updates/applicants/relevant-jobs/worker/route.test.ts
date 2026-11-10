import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { finishProfileRefresh } from "@/helpers/user/queue-profile-refresh";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/jobs/relevant-jobs-utils", () => ({ processUserRelevance: vi.fn() }));
vi.mock("@/helpers/user/queue-profile-refresh", () => ({ finishProfileRefresh: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const USER_ID = "c1000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const withSecret = (secret: string | null) =>
  vi.mocked(headers).mockResolvedValue(new Headers(secret ? { "X-Internal-Secret": secret } : {}) as never);

const message = (read_ct: number) => ({ msg_id: 7, read_ct, message: { userId: USER_ID } });

const queueMessages = (messages: unknown[]) =>
  supabase.queueRpc("read", { data: messages, error: null }, "pgmq_public");

const rpcCalls = (fn: string) =>
  supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === fn);

const userWrites = () =>
  supabase.callsFor("user_info").filter((c) => c.chain.some((m) => m.method === "update"));

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  vi.mocked(finishProfileRefresh).mockResolvedValue({ requeued: false });
  withSecret("test-secret");
});

describe("GET /api/updates/applicants/relevant-jobs/worker", () => {
  it("rejects a missing or wrong secret", async () => {
    withSecret("nope");

    expect((await GET()).status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rebuilds the feed, deletes the message and queues a follow-up check", async () => {
    queueMessages([message(1)]);
    vi.mocked(processUserRelevance).mockResolvedValue({ success: true });

    await GET();

    expect(processUserRelevance).toHaveBeenCalledWith(USER_ID, true);
    expect(rpcCalls("delete")).toHaveLength(1);
    expect(finishProfileRefresh).toHaveBeenCalledWith(USER_ID, expect.any(String));
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  describe("retries keep the running state (SM-REQ-013, SM-TEST-011)", () => {
    it.each([1, 2])("leaves the status, emails nobody and keeps the message after failed attempt %i", async (readCt) => {
      queueMessages([message(readCt)]);
      vi.mocked(processUserRelevance).mockResolvedValue({ success: false, error: "rerank down" });

      await GET();

      expect(userWrites()).toHaveLength(0);
      expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
      expect(rpcCalls("delete")).toHaveLength(0);
    });

    it("on the last attempt moves the user to failed from progress only, emails once and drops the message", async () => {
      queueMessages([message(3)]);
      supabase.queue("user_info", { data: [{ user_id: USER_ID }], error: null });
      vi.mocked(processUserRelevance).mockResolvedValue({ success: false, error: "rerank down" });

      await GET();

      const [write] = userWrites();
      expect(userWrites()).toHaveLength(1);
      expect(write.chain).toContainEqual({ method: "in", args: ["user_id", [USER_ID]] });
      expect(write.chain).toContainEqual({ method: "in", args: ["relevant_jobs_update_status", ["progress"]] });
      expect(write.chain.find((m) => m.method === "update")!.args[0]).toMatchObject({
        relevant_jobs_update_status: "failed",
      });
      expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
      expect(rpcCalls("delete")).toHaveLength(1);
      expect(finishProfileRefresh).not.toHaveBeenCalled();
    });
  });
});
