import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

describe("createSupabaseMock", () => {
  it("resolves { data: null, error: null } when nothing is queued", async () => {
    const mock = createSupabaseMock();

    const result = await mock.client.from("all_jobs").select("*");

    expect(result).toEqual({ data: null, error: null });
  });

  it("records the table and every chained call with its arguments", async () => {
    const mock = createSupabaseMock();

    await mock.client
      .from("all_jobs")
      .select("id, job_name")
      .eq("status", "active")
      .in("platform", ["ycombinator", "wellfound"])
      .order("created_at", { ascending: false })
      .range(0, 19);

    expect(mock.calls).toEqual([
      {
        kind: "from",
        schema: "public",
        target: "all_jobs",
        chain: [
          { method: "select", args: ["id, job_name"] },
          { method: "eq", args: ["status", "active"] },
          { method: "in", args: ["platform", ["ycombinator", "wellfound"]] },
          { method: "order", args: ["created_at", { ascending: false }] },
          { method: "range", args: [0, 19] },
        ],
      },
    ]);
  });

  it("returns queued responses per table in FIFO order, then falls back to the default", async () => {
    const mock = createSupabaseMock();
    mock.queue("resumes", { data: [{ id: "r1" }], error: null });
    mock.queue("resumes", { data: [{ id: "r2" }], error: null });

    const first = await mock.client.from("resumes").select("*");
    const second = await mock.client.from("resumes").select("*");
    const third = await mock.client.from("resumes").select("*");

    expect(first.data).toEqual([{ id: "r1" }]);
    expect(second.data).toEqual([{ id: "r2" }]);
    expect(third).toEqual({ data: null, error: null });
  });

  it("keeps queues separate per table", async () => {
    const mock = createSupabaseMock();
    mock.queue("resumes", { data: "resume", error: null });
    mock.queue("user_info", { data: "profile", error: null });

    const profile = await mock.client.from("user_info").select("*").single();
    const resume = await mock.client.from("resumes").select("*").single();

    expect(profile.data).toBe("profile");
    expect(resume.data).toBe("resume");
  });

  it("supports a function response computed from the recorded call", async () => {
    const mock = createSupabaseMock();
    mock.queue("all_jobs", (call) => ({
      data: call.chain.find((c) => c.method === "eq")?.args[1] ?? null,
      error: null,
    }));

    const result = await mock.client.from("all_jobs").select("*").eq("id", "job-42");

    expect(result.data).toBe("job-42");
  });

  it("records write builders (insert, upsert, update, delete)", async () => {
    const mock = createSupabaseMock();

    await mock.client.from("user_favorites").insert({ job_id: "j1", user_id: "u1" });
    await mock.client
      .from("agent_messages" as never)
      .upsert([{ id: "m1" }] as never, { onConflict: "id" });
    await mock.client.from("user_info").update({ ai_credits: 5 }).eq("user_id", "u1");
    await mock.client.from("user_favorites").delete().eq("job_id", "j1");

    expect(mock.calls.map((c) => [c.target, c.chain[0].method])).toEqual([
      ["user_favorites", "insert"],
      ["agent_messages", "upsert"],
      ["user_info", "update"],
      ["user_favorites", "delete"],
    ]);
    expect(mock.calls[1].chain[0].args).toEqual([[{ id: "m1" }], { onConflict: "id" }]);
  });

  it("records rpc calls and returns queued rpc responses", async () => {
    const mock = createSupabaseMock();
    mock.queueRpc("deduct_user_credits", {
      data: null,
      error: { message: "Insufficient credits" },
    });

    const result = await mock.client.rpc("deduct_user_credits", {
      p_user_id: "u1",
      p_amount: 2,
    });

    expect(result.error).toEqual({ message: "Insufficient credits" });
    expect(mock.calls).toEqual([
      {
        kind: "rpc",
        schema: "public",
        target: "deduct_user_credits",
        chain: [
          {
            method: "rpc",
            args: ["deduct_user_credits", { p_user_id: "u1", p_amount: 2 }],
          },
        ],
      },
    ]);
  });

  it("tracks the schema for schema(...).rpc and schema(...).from", async () => {
    const mock = createSupabaseMock();
    mock.queueRpc("send", { data: [1], error: null }, "pgmq_public");

    const result = await mock.client
      .schema("pgmq_public")
      .rpc("send", { queue_name: "job_digest", message: {}, sleep_seconds: 0 });

    expect(result.data).toEqual([1]);
    expect(mock.calls[0]).toMatchObject({
      kind: "rpc",
      schema: "pgmq_public",
      target: "send",
    });
  });

  it("filters calls by table with callsFor", async () => {
    const mock = createSupabaseMock();

    await mock.client.from("resumes").select("*");
    await mock.client.from("user_info").select("*");
    await mock.client.from("resumes").delete().eq("id", "r1");

    expect(mock.callsFor("resumes")).toHaveLength(2);
    expect(mock.callsFor("user_info")).toHaveLength(1);
  });

  it("returns the configured user from auth.getUser", async () => {
    const mock = createSupabaseMock({ user: { id: "u1" } });

    const { data, error } = await mock.client.auth.getUser();

    expect(error).toBeNull();
    expect(data.user?.id).toBe("u1");
  });

  it("returns a null user from auth.getUser by default", async () => {
    const mock = createSupabaseMock();

    const { data } = await mock.client.auth.getUser();

    expect(data.user).toBeNull();
  });

  it("can be reset", async () => {
    const mock = createSupabaseMock();
    mock.queue("resumes", { data: "queued", error: null });
    await mock.client.from("user_info").select("*");

    mock.reset();

    expect(mock.calls).toEqual([]);
    expect(await mock.client.from("resumes").select("*")).toEqual({
      data: null,
      error: null,
    });
  });
});
