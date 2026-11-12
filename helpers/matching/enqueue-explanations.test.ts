import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type RecordedCall } from "@/test/utils/supabase-mock";
import { MATCH_EXPLAIN_TOP_N } from "./config";
import { enqueueTopExplanations, MATCH_EXPLANATION_QUEUE } from "./enqueue-explanations";

vi.mock("server-only", () => ({}));

const JOB = "j0000000-0000-4000-8000-000000000001";

const inArgs = (call: RecordedCall, column: string) =>
  call.chain.find((m) => m.method === "in" && m.args[0] === column)?.args[1] as string[] | undefined;
const updateOf = (call: RecordedCall) =>
  call.chain.find((m) => m.method === "update")?.args[0] as { explanation_status: string } | undefined;
const sentUsers = (db: ReturnType<typeof createSupabaseMock>) =>
  db.callsFor("send").map((c) => (c.chain[0].args[1] as { message: { userId: string } }).message.userId);

describe("enqueueTopExplanations (SMT-021, SM-ISS-003, SM-TEST-010)", () => {
  it("marks the top none/stale rows queued, from none or stale only, before any send", async () => {
    const db = createSupabaseMock();
    db.queue("job_relevant_profiles", { data: [{ user_id: "a" }, { user_id: "c" }], error: null });
    const rows = [
      { user_id: "a", explanation_status: "none" },
      { user_id: "b", explanation_status: "completed" },
      { user_id: "c", explanation_status: "stale" },
      { user_id: "d", explanation_status: "queued" },
    ];

    const sent = await enqueueTopExplanations(db.client, JOB, rows);

    expect(sent).toEqual(["a", "c"]);
    const [mark] = db.callsFor("job_relevant_profiles");
    expect(updateOf(mark)).toEqual({ explanation_status: "queued" });
    expect(inArgs(mark, "user_id")).toEqual(["a", "c"]);
    expect(inArgs(mark, "explanation_status")).toEqual(["none", "stale"]);
    expect(mark.chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB] });
    expect(db.calls.indexOf(mark)).toBeLessThan(db.calls.indexOf(db.callsFor("send")[0]));
    expect(db.callsFor("send")[0].chain[0].args[1]).toEqual({
      queue_name: MATCH_EXPLANATION_QUEUE,
      message: { jobPostId: JOB, userId: "a" },
      sleep_seconds: 0,
    });
  });

  it("sends only for the rows the mark moved (a worker or on-demand call got the others)", async () => {
    const db = createSupabaseMock();
    db.queue("job_relevant_profiles", { data: [{ user_id: "a" }], error: null });

    const sent = await enqueueTopExplanations(db.client, JOB, [
      { user_id: "a", explanation_status: "none" },
      { user_id: "b", explanation_status: "stale" },
    ]);

    expect(sent).toEqual(["a"]);
    expect(sentUsers(db)).toEqual(["a"]);
  });

  it("only looks at the top N", async () => {
    const db = createSupabaseMock();
    const rows = Array.from({ length: MATCH_EXPLAIN_TOP_N + 3 }, (_, i) => ({ user_id: `u${i}`, explanation_status: "none" }));
    db.queue("job_relevant_profiles", { data: [], error: null });

    await enqueueTopExplanations(db.client, JOB, rows);

    expect(inArgs(db.callsFor("job_relevant_profiles")[0], "user_id")).toHaveLength(MATCH_EXPLAIN_TOP_N);
  });

  it("moves an unsent row back from queued to the state it had", async () => {
    const db = createSupabaseMock();
    db.queue("job_relevant_profiles", { data: [{ user_id: "a" }, { user_id: "b" }], error: null });
    db.queueRpc("send", { data: null, error: { message: "down" } }, "pgmq_public");
    db.queueRpc("send", { data: null, error: { message: "down" } }, "pgmq_public");

    const sent = await enqueueTopExplanations(db.client, JOB, [
      { user_id: "a", explanation_status: "none" },
      { user_id: "b", explanation_status: "stale" },
    ]);

    expect(sent).toEqual([]);
    const backs = db.callsFor("job_relevant_profiles").slice(1);
    expect(backs.map((c) => [updateOf(c)!.explanation_status, inArgs(c, "user_id"), inArgs(c, "explanation_status")])).toEqual([
      ["none", ["a"], ["queued"]],
      ["stale", ["b"], ["queued"]],
    ]);
  });

  it("does nothing when no row needs an explanation", async () => {
    const db = createSupabaseMock();

    expect(await enqueueTopExplanations(db.client, JOB, [{ user_id: "a", explanation_status: "completed" }])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it("throws when marking the rows fails, before sending anything", async () => {
    const db = createSupabaseMock();
    db.queue("job_relevant_profiles", { data: null, error: { message: "db down" } });

    await expect(
      enqueueTopExplanations(db.client, JOB, [{ user_id: "a", explanation_status: "none" }]),
    ).rejects.toThrow(/db down/);
    expect(db.callsFor("send")).toHaveLength(0);
  });
});
