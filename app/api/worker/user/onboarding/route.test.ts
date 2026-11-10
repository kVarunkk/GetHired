import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { parseResume } from "@/helpers/resume/parse-resume";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { finishProfileRefresh } from "@/helpers/user/queue-profile-refresh";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/jobs/relevant-jobs-utils", () => ({ processUserRelevance: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/helpers/resume/parse-resume", () => ({ parseResume: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/helpers/user/queue-profile-refresh", () => ({ finishProfileRefresh: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const USER_ID = "c1000000-0000-4000-8000-000000000001";
const RESUME_ID = "d1000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const withSecret = (secret: string | null) =>
  vi.mocked(headers).mockResolvedValue(
    new Headers(secret ? { "X-Internal-Secret": secret } : {}) as never,
  );

const message = (read_ct: number) => ({
  msg_id: 7,
  read_ct,
  message: { userId: USER_ID, resumeId: RESUME_ID, shouldParse: false },
});

const queueMessages = (messages: unknown[]) =>
  supabase.queueRpc("read", { data: messages, error: null }, "pgmq_public");

const rpcCalls = (fn: string) =>
  supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === fn);

/** Every status the worker wrote to user_info, in order. */
const statusWrites = () =>
  supabase
    .callsFor("user_info")
    .map((c) => c.chain.find((m) => m.method === "update")?.args[0] as Record<string, unknown>)
    .filter(Boolean)
    .map((u) => u.relevant_jobs_update_status);

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  withSecret("test-secret");
  vi.mocked(updateUserEmbedding).mockResolvedValue({ success: true });
  vi.mocked(processUserRelevance).mockResolvedValue({ success: true });
  vi.mocked(finishProfileRefresh).mockResolvedValue({ requeued: false });
});

describe("GET /api/worker/user/onboarding", () => {
  it("rejects a missing or wrong secret", async () => {
    withSecret("nope");

    expect((await GET()).status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  it("reads with a visibility timeout longer than one run, so the next call doesn't process the user twice", async () => {
    queueMessages([]);

    await GET();

    expect(rpcCalls("read")[0].chain[0].args[1]).toEqual({
      queue_name: "onboarding_pipeline",
      sleep_seconds: 300,
      n: 2,
    });
  });

  it("embeds, builds the feed and deletes the message", async () => {
    queueMessages([message(1)]);

    await GET();

    expect(parseResume).not.toHaveBeenCalled();
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER_ID);
    expect(processUserRelevance).toHaveBeenCalledWith(USER_ID, true);
    expect(statusWrites()).toEqual(["progress"]);
    expect(rpcCalls("delete")).toHaveLength(1);
  });

  it("after a run, checks for profile changes made since it started, so they get one more run", async () => {
    queueMessages([message(1)]);
    let embeddedAt = "";
    vi.mocked(updateUserEmbedding).mockImplementation(async () => {
      embeddedAt = new Date().toISOString();
      return { success: true };
    });

    await GET();

    expect(finishProfileRefresh).toHaveBeenCalledTimes(1);
    const [userId, startedAt] = vi.mocked(finishProfileRefresh).mock.calls[0];
    expect(userId).toBe(USER_ID);
    // The start is taken before the profile is read for the embedding.
    expect(startedAt <= embeddedAt).toBe(true);
  });

  it("handles a refresh message, which has no resume", async () => {
    queueMessages([{ msg_id: 8, read_ct: 1, message: { userId: USER_ID, shouldParse: false } }]);

    await GET();

    expect(parseResume).not.toHaveBeenCalled();
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER_ID);
    expect(rpcCalls("delete")).toHaveLength(1);
  });

  it("starts no follow-up after a failed run: its retry reads the profile again", async () => {
    queueMessages([message(1)]);
    vi.mocked(processUserRelevance).mockResolvedValue({ success: false, error: "rerank down" });

    await GET();

    expect(finishProfileRefresh).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    "keeps the status at progress and the message queued after failed attempt %i",
    async (readCt) => {
      queueMessages([message(readCt)]);
      vi.mocked(processUserRelevance).mockResolvedValue({ success: false, error: "rerank down" });

      await GET();

      expect(statusWrites()).toEqual(["progress"]);
      expect(rpcCalls("delete")).toHaveLength(0);
      expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
    },
  );

  it("runs the third attempt, and on failure marks the user failed and drops the message", async () => {
    queueMessages([message(3)]);
    vi.mocked(updateUserEmbedding).mockResolvedValue({ success: false, error: "boom" });

    await GET();

    expect(updateUserEmbedding).toHaveBeenCalled();
    expect(statusWrites()).toEqual(["failed"]);
    expect(rpcCalls("delete")).toHaveLength(1);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(
      expect.stringContaining("POISON ALERT"),
    );
  });

  it("moves the user back into progress only from a finished state, keeping a running start time (SM-REQ-004)", async () => {
    queueMessages([message(1)]);

    await GET();

    const progressWrite = supabase
      .callsFor("user_info")
      .find((c) => (c.chain.find((m) => m.method === "update")?.args[0] as Record<string, unknown> | undefined)
        ?.relevant_jobs_update_status === "progress")!;
    expect(progressWrite.chain).toContainEqual({ method: "in", args: ["user_id", [USER_ID]] });
    expect(progressWrite.chain).toContainEqual({
      method: "in",
      args: ["relevant_jobs_update_status", ["pending", "failed", "completed"]],
    });
  });

  it("moves the user to failed from progress only when it gives up (SM-REQ-013)", async () => {
    queueMessages([message(3)]);
    vi.mocked(processUserRelevance).mockResolvedValue({ success: false, error: "rerank down" });

    await GET();

    const failedWrite = supabase
      .callsFor("user_info")
      .find((c) => (c.chain.find((m) => m.method === "update")?.args[0] as Record<string, unknown> | undefined)
        ?.relevant_jobs_update_status === "failed")!;
    expect(failedWrite.chain).toContainEqual({ method: "in", args: ["user_id", [USER_ID]] });
    expect(failedWrite.chain).toContainEqual({ method: "in", args: ["relevant_jobs_update_status", ["progress"]] });
  });

  it("succeeds on the third attempt", async () => {
    queueMessages([message(3)]);

    await GET();

    expect(statusWrites()).toEqual(["progress"]);
    expect(rpcCalls("delete")).toHaveLength(1);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("drops a message whose earlier runs never finished, without running it", async () => {
    queueMessages([message(4)]);

    await GET();

    expect(updateUserEmbedding).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual(["failed"]);
    expect(rpcCalls("delete")).toHaveLength(1);
  });
});
