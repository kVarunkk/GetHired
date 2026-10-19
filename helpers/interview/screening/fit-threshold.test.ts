import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { inviteAboveFitThreshold } from "./fit-threshold";

vi.mock("server-only", () => ({}));

const APP = "e0000000-0000-4000-8000-000000000001";
const JOB = "b0000000-0000-4000-8000-0000000000a1";
let db: SupabaseMock;

const config = (overrides: Record<string, unknown> = {}) =>
  db.queue("job_interview_configs", {
    data: { enabled: true, invite_rule: "fit_threshold", fit_threshold: 70, ...overrides },
    error: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("inviteAboveFitThreshold (SI-REQ-010, SIT-03C)", () => {
  it("invites at the threshold, with no actor (the RPC queues the email)", async () => {
    config();
    db.queueRpc("create_screening_invite", { data: { ok: true, id: "ai1" }, error: null });

    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore: 70 })).toEqual({
      invited: true,
      id: "ai1",
    });
    expect(db.callsFor("create_screening_invite")[0].chain[0].args[1]).toEqual({
      p_application_id: APP,
      p_via: "fit_threshold",
    });
  });

  it.each([
    ["below the threshold", {}, 69],
    ["a disabled interview", { enabled: false }, 90],
    ["a manual job", { invite_rule: "manual" }, 90],
  ])("doesn't invite for %s", async (_, overrides, fitScore) => {
    config(overrides);
    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore })).toMatchObject({
      invited: false,
    });
    expect(db.callsFor("create_screening_invite")).toHaveLength(0);
  });

  it("doesn't invite for a job without a config", async () => {
    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore: 99 })).toEqual({
      invited: false,
      reason: "disabled",
    });
  });

  it("an existing invite is a no-op (a re-screen never invites twice)", async () => {
    config();
    db.queueRpc("create_screening_invite", { data: { ok: false, reason: "exists" }, error: null });
    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore: 80 })).toEqual({
      invited: false,
      reason: "exists",
    });
  });

  it("reports an allowance failure without throwing", async () => {
    config();
    db.queueRpc("create_screening_invite", { data: { ok: false, reason: "insufficient_credits" }, error: null });
    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore: 80 })).toEqual({
      invited: false,
      reason: "insufficient_credits",
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it("never throws on an RPC error", async () => {
    config();
    db.queueRpc("create_screening_invite", { data: null, error: { message: "down" } });
    expect(await inviteAboveFitThreshold(db.client, { applicationId: APP, jobPostId: JOB, fitScore: 80 })).toEqual({
      invited: false,
      reason: "failed",
    });
  });
});
