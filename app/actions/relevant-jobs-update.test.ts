import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { triggerRelevanceUpdate } from "./relevant-jobs-update";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

const USER_ID = "a0000000-0000-4000-8000-0000000000c1";
let supabase: SupabaseMock;

const start = (data: unknown, error: unknown = null) => supabase.queueRpc("start_relevance", { data, error });
const sends = () => supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === "send");

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  vi.mocked(getUserFromRequest).mockResolvedValue({ id: USER_ID, app_metadata: { type: "applicant" } } as never);
});

describe("triggerRelevanceUpdate (SM-REQ-004)", () => {
  it("starts the session user's run through start_relevance, then queues it", async () => {
    start({ ok: true });

    const result = await triggerRelevanceUpdate();

    expect(result).toEqual({ success: true, message: "processing started" });
    expect(supabase.callsFor("start_relevance")[0].chain[0].args[1]).toEqual({
      p_user_id: USER_ID,
      p_timeout_seconds: 1200,
    });
    expect(sends()[0].chain[0].args[1]).toEqual({
      queue_name: "relevance_jobs",
      message: { userId: USER_ID },
      sleep_seconds: 0,
    });
    // No read-then-write: the start is the only status write.
    expect(supabase.callsFor("user_info")).toHaveLength(0);
  });

  it("sends no message while a run is going (SM-TEST-005)", async () => {
    start({ ok: false, reason: "in_progress" });

    expect(await triggerRelevanceUpdate()).toEqual({
      success: false,
      error: "Your matches are already being generated.",
    });
    expect(sends()).toHaveLength(0);
  });

  it("answers profile not found", async () => {
    start({ ok: false, reason: "profile_not_found" });

    expect(await triggerRelevanceUpdate()).toEqual({ success: false, error: "Profile not found." });
    expect(sends()).toHaveLength(0);
  });

  it("moves the status to failed from progress only when the message can't be sent", async () => {
    start({ ok: true });
    supabase.queueRpc("send", { data: null, error: { message: "queue down" } }, "pgmq_public");

    const result = await triggerRelevanceUpdate();

    expect(result).toMatchObject({ success: false });
    const [failed] = supabase.callsFor("user_info");
    expect(failed.chain.find((m) => m.method === "update")!.args[0]).toMatchObject({
      relevant_jobs_update_status: "failed",
    });
    expect(failed.chain).toContainEqual({ method: "in", args: ["user_id", [USER_ID]] });
    expect(failed.chain).toContainEqual({ method: "in", args: ["relevant_jobs_update_status", ["progress"]] });
  });

  it("refuses a company user and a signed-out request without starting anything", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce({ id: USER_ID, app_metadata: { type: "company" } } as never);
    expect(await triggerRelevanceUpdate()).toMatchObject({ success: false });
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    expect(await triggerRelevanceUpdate()).toMatchObject({ success: false });
    expect(supabase.calls).toHaveLength(0);
  });
});
