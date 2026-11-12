import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type RecordedCall } from "@/test/utils/supabase-mock";
import { markJobResultsStale } from "./mark-stale";

vi.mock("server-only", () => ({}));

const JOB_ID = "b0000000-0000-4000-8000-000000000001";

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const updateOf = (call: RecordedCall) =>
  call.chain.find((m) => m.method === "update")!.args[0] as Record<string, unknown>;
/** The guarded write that moves `from` states (SM-REQ-001). */
const writeFrom = (calls: RecordedCall[], column: string, from: string[]) =>
  calls.find((c) => c.chain.some((m) => m.method === "in" && m.args[0] === column && String(m.args[1]) === String(from)));

/** Queues the four guarded writes, in order, with what each one moved. */
function setup({
  staleScreenings = [] as string[],
  requeuedScreenings = [] as string[],
  staleExplanations = [] as string[],
  requeuedExplanations = [] as string[],
} = {}) {
  const admin = createSupabaseMock();
  admin.queue("application_screenings", { data: staleScreenings.map((id) => ({ application_id: id })), error: null });
  admin.queue("application_screenings", { data: requeuedScreenings.map((id) => ({ application_id: id })), error: null });
  admin.queue("job_relevant_profiles", { data: staleExplanations.map((id) => ({ user_id: id })), error: null });
  admin.queue("job_relevant_profiles", { data: requeuedExplanations.map((id) => ({ user_id: id })), error: null });
  return admin;
}

describe("markJobResultsStale", () => {
  it("marks completed screenings stale and re-queues them with the unscored ones (BI-REQ-036)", async () => {
    const admin = setup({ staleScreenings: ["e1"], requeuedScreenings: ["ea1"] });
    admin.queueRpc("send_batch", { data: null, error: null }, "pgmq_public");

    await markJobResultsStale(admin.client, JOB_ID);

    const screenings = admin.callsFor("application_screenings");
    const stale = writeFrom(screenings, "status", ["completed"])!;
    expect(stale.chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_ID] });
    expect(updateOf(stale)).toMatchObject({ status: "stale", attempts: 0 });
    const requeued = writeFrom(screenings, "status", ["insufficient_info", "processing"])!;
    expect(updateOf(requeued)).toMatchObject({ status: "queued", attempts: 0 });
    const [send] = admin.callsFor("send_batch");
    expect(send.chain[0].args[1]).toMatchObject({
      messages: [{ application_id: "e1" }, { application_id: "ea1" }],
    });
  });

  it("re-queues a running screening and clears its claim, so the run's result is refused (SM-REQ-006)", async () => {
    const admin = setup({ requeuedScreenings: ["running"] });

    await markJobResultsStale(admin.client, JOB_ID);

    const requeued = writeFrom(admin.callsFor("application_screenings"), "status", ["insufficient_info", "processing"])!;
    expect(requeued.chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_ID] });
    expect(updateOf(requeued)).toMatchObject({ status: "queued", claimed_at: null });
    const [send] = admin.callsFor("send_batch");
    expect(send.chain[0].args[1]).toMatchObject({ messages: [{ application_id: "running" }] });
  });

  it("marks completed explanations stale, from completed only", async () => {
    const admin = setup({ staleExplanations: ["u1"] });

    await markJobResultsStale(admin.client, JOB_ID);

    const stale = writeFrom(admin.callsFor("job_relevant_profiles"), "explanation_status", ["completed"])!;
    expect(stale.chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_ID] });
    expect(updateOf(stale)).toEqual({ explanation_status: "stale" });
    // Re-queued by the next digest, not here.
    expect(admin.callsFor("send")).toHaveLength(0);
  });

  it("re-queues a running explanation, clears its claim and sends it a message (SM-REQ-006)", async () => {
    const admin = setup({ requeuedExplanations: ["u-running"] });

    await markJobResultsStale(admin.client, JOB_ID);

    const requeued = writeFrom(admin.callsFor("job_relevant_profiles"), "explanation_status", ["processing"])!;
    expect(requeued.chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_ID] });
    expect(updateOf(requeued)).toEqual({ explanation_status: "queued", claimed_at: null });
    const [send] = admin.callsFor("send");
    expect(send.chain[0].args[1]).toMatchObject({
      queue_name: "match_explanation_queue",
      message: { jobPostId: JOB_ID, userId: "u-running" },
    });
  });

  it("moves an explanation it couldn't send to stale, from queued only, so the next digest picks it up", async () => {
    const admin = setup({ requeuedExplanations: ["u-running"] });
    admin.queueRpc("send", { data: null, error: { message: "queue down" } }, "pgmq_public");

    await markJobResultsStale(admin.client, JOB_ID);

    const reverted = writeFrom(admin.callsFor("job_relevant_profiles"), "explanation_status", ["queued"])!;
    expect(updateOf(reverted)).toEqual({ explanation_status: "stale" });
    expect(reverted.chain).toContainEqual({ method: "in", args: ["user_id", ["u-running"]] });
  });

  it("marks the re-queued screenings failed from queued only when the send fails, and throws", async () => {
    const admin = setup({ requeuedScreenings: ["running"] });
    admin.queueRpc("send_batch", { data: null, error: { message: "queue down" } }, "pgmq_public");

    await expect(markJobResultsStale(admin.client, JOB_ID)).rejects.toThrow(/queue/);

    const failed = writeFrom(admin.callsFor("application_screenings"), "status", ["queued"])!;
    expect(updateOf(failed)).toMatchObject({ status: "failed" });
    expect(failed.chain).toContainEqual({ method: "in", args: ["application_id", ["running"]] });
  });

  it("sends nothing when no row moved", async () => {
    const admin = setup();

    await markJobResultsStale(admin.client, JOB_ID);

    expect(admin.calls.filter((c) => c.kind === "rpc")).toHaveLength(0);
    expect(admin.calls.filter((c) => has(c, "update"))).toHaveLength(4);
  });
});
