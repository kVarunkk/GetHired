import { RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { reportError } from "@/helpers/posthog/report-error";
import { finishProfileRefresh, queueProfileRefresh, refreshProfileAfterChange } from "./queue-profile-refresh";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

let service: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateUserEmbedding).mockResolvedValue({ success: true });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("queueProfileRefresh", () => {
  it("queues through one service-role call, with the stale window in seconds", async () => {
    service.queueRpc("queue_profile_refresh", { data: { ok: true, queued: true }, error: null });

    expect(await queueProfileRefresh("u1")).toEqual({ queued: true });
    expect(service.calls).toHaveLength(1);
    expect(service.callsFor("queue_profile_refresh")[0].chain[0].args[1]).toEqual({
      p_user_id: "u1",
      p_stale_seconds: RELEVANCE_TIMEOUT_MS / 1000,
    });
  });

  it("reports a change deferred to the running run's follow-up", async () => {
    service.queueRpc("queue_profile_refresh", { data: { ok: true, queued: false, deferred: true }, error: null });
    expect(await queueProfileRefresh("u1")).toEqual({ queued: false, reason: "deferred" });
  });

  it.each(["not_onboarded", "profile_not_found"])("reports %s", async (reason) => {
    service.queueRpc("queue_profile_refresh", { data: { ok: false, reason }, error: null });
    expect(await queueProfileRefresh("u1")).toEqual({ queued: false, reason });
  });

  it("throws database errors and unknown answers", async () => {
    service.queueRpc("queue_profile_refresh", { data: null, error: new Error("down") });
    await expect(queueProfileRefresh("u1")).rejects.toThrow("down");

    service.queueRpc("queue_profile_refresh", { data: { ok: false, reason: "odd" }, error: null });
    await expect(queueProfileRefresh("u1")).rejects.toThrow("odd");
  });
});

describe("refreshProfileAfterChange", () => {
  it("only queues when it can: the worker embeds", async () => {
    service.queueRpc("queue_profile_refresh", { data: { ok: true, queued: true }, error: null });

    expect(await refreshProfileAfterChange("u1")).toBe("queued");
    expect(updateUserEmbedding).not.toHaveBeenCalled();
  });

  it("re-embeds now when the refresh was deferred, so search doesn't wait for the follow-up", async () => {
    service.queueRpc("queue_profile_refresh", { data: { ok: true, queued: false, deferred: true }, error: null });

    expect(await refreshProfileAfterChange("u1")).toBe("deferred");
    expect(updateUserEmbedding).toHaveBeenCalledWith("u1");
  });

  it.each([
    ["not_onboarded", "not_refreshed"],
    ["profile_not_found", "not_refreshed"],
  ])("re-embeds here when the refresh is refused (%s)", async (reason, outcome) => {
    service.queueRpc("queue_profile_refresh", { data: { ok: false, reason }, error: null });

    expect(await refreshProfileAfterChange("u1")).toBe(outcome);
    expect(updateUserEmbedding).toHaveBeenCalledWith("u1");
  });

  it("re-embeds and never throws when queueing fails", async () => {
    service.queueRpc("queue_profile_refresh", { data: null, error: new Error("down") });

    expect(await refreshProfileAfterChange("u1")).toBe("not_refreshed");
    expect(reportError).toHaveBeenCalled();
    expect(updateUserEmbedding).toHaveBeenCalledWith("u1");
  });
});

describe("finishProfileRefresh", () => {
  it("asks the database whether a change came in after the run started", async () => {
    service.queueRpc("finish_profile_refresh", { data: { ok: true, requeued: true }, error: null });

    expect(await finishProfileRefresh("u1", "2026-11-08T10:00:00.000Z")).toEqual({ requeued: true });
    expect(service.callsFor("finish_profile_refresh")[0].chain[0].args[1]).toEqual({
      p_user_id: "u1",
      p_started_at: "2026-11-08T10:00:00.000Z",
    });
  });

  it("never throws: the run is already done", async () => {
    service.queueRpc("finish_profile_refresh", { data: null, error: new Error("down") });

    expect(await finishProfileRefresh("u1", "2026-11-08T10:00:00.000Z")).toEqual({ requeued: false });
    expect(reportError).toHaveBeenCalled();
  });
});
