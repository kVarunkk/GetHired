import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { hashSchedulingToken } from "./scheduling-token";
import { listMyScheduledInterviews, openMySchedulingLink } from "./my-scheduled-interviews";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const ID = "f1000000-0000-4000-8000-000000000001";

describe("my scheduled interviews (IVT-064, IV-REQ-043)", () => {
  it("reads through my_scheduled_interviews only", async () => {
    const db = createSupabaseMock();
    db.queueRpc("my_scheduled_interviews", { data: [{ id: ID }], error: null });
    expect(await listMyScheduledInterviews(db.client)).toEqual([{ id: ID }]);
    expect(db.calls.map((c) => c.target)).toEqual(["my_scheduled_interviews"]);
  });

  it("reads a failure as no interviews", async () => {
    const db = createSupabaseMock();
    db.queueRpc("my_scheduled_interviews", { data: null, error: { message: "boom" } });
    expect(await listMyScheduledInterviews(db.client)).toEqual([]);
  });

  it("opens the link with a new token, storing only its hash", async () => {
    const db = createSupabaseMock();
    db.queueRpc("rotate_my_scheduling_link", { data: { ok: true }, error: null });
    const result = await openMySchedulingLink(db.client, ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = result.path.replace("/schedule/", "");
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(db.callsFor("rotate_my_scheduling_link")[0].chain[0].args[1]).toEqual({
      p_interview_id: ID,
      p_token_hash: hashSchedulingToken(token),
    });
  });

  it("refuses an interview that's not theirs or not open", async () => {
    const db = createSupabaseMock();
    db.queueRpc("rotate_my_scheduling_link", { data: { ok: false, reason: "not_found" }, error: null });
    expect(await openMySchedulingLink(db.client, ID)).toMatchObject({ ok: false });
  });
});
