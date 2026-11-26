import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgentPageData } from "./page-data";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

const S1 = { id: "s1", title: "Newest", updated_at: "2026-10-11T00:00:00.000Z" };
const S2 = { id: "s2", title: "Older", updated_at: "2026-10-10T00:00:00.000Z" };

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("loadAgentPageData", () => {
  it("opens the requested session when it belongs to the user", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_messages", {
      data: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null }],
      error: null,
    });

    supabase.queue("agent_feedback", {
      data: [{ message_id: "m2", kind: "reply", rating: 1, dismissed: false }],
      error: null,
    });

    const data = await loadAgentPageData(supabase.client, "u1", "s2");

    expect({ ...data, ...(await data!.chat), chat: undefined }).toEqual({
      sessions: [S1, S2],
      activeSessionId: "s2",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      feedback: { m2: { reply: 1 } },
    });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "select", args: ["id, title, updated_at, role"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "order", args: ["updated_at", { ascending: false }] },
    ]);
  });

  it("opens the newest session when none is requested", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined);

    expect(data?.activeSessionId).toBe("s1");
    expect((await data!.chat).messages).toEqual([]);
  });

  it("returns null for a session that isn't the user's", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });

    expect(await loadAgentPageData(supabase.client, "u1", "someone-elses")).toBeNull();
    expect(await loadAgentPageData(supabase.client, "u1", "someone-elses", { newChat: true })).toBeNull();
  });

  it("returns null for a requested id without creating a first session", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });

    expect(await loadAgentPageData(supabase.client, "u1", "s9")).toBeNull();
    expect(supabase.callsFor("agent_sessions")).toHaveLength(1);
  });

  it("creates a first session for new users", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });
    supabase.queue("agent_sessions", { data: { id: "s9", title: "New chat", updated_at: "now" }, error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined);

    expect(data?.sessions).toEqual([{ id: "s9", title: "New chat", updated_at: "now" }]);
    expect(data?.activeSessionId).toBe("s9");
    expect(supabase.callsFor("agent_sessions")[1].chain).toEqual([
      { method: "insert", args: [{ user_id: "u1" }] },
      { method: "select", args: ["id, title, updated_at"] },
      { method: "single", args: [] },
    ]);
  });

  it("opens a new chat for a prompt when the newest one has messages", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_messages", {
      data: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null }],
      error: null,
    });
    const created = { id: "s9", title: "New chat", updated_at: "now" };
    supabase.queue("agent_sessions", { data: created, error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined, { newChat: true });

    expect(data).toMatchObject({ sessions: [created, S1, S2], activeSessionId: "s9" });
    expect(await data!.chat).toEqual({ messages: [], feedback: {} });
  });

  it("reuses the newest chat for a prompt when it is still empty", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined, { newChat: true });

    expect(data).toMatchObject({ sessions: [S1, S2], activeSessionId: "s1" });
    expect(await data!.chat).toEqual({ messages: [], feedback: {} });
    expect(supabase.callsFor("agent_sessions")).toHaveLength(1);
  });

  it("keeps a requested session even with a prompt", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_messages", {
      data: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null }],
      error: null,
    });

    const data = await loadAgentPageData(supabase.client, "u1", "s2", { newChat: true });

    expect(data?.activeSessionId).toBe("s2");
    expect(supabase.callsFor("agent_sessions")).toHaveLength(1);
  });

  it("loads a requested chat without waiting for the session list", async () => {
    let answerList = () => {};
    const list = new Promise<void>((resolve) => (answerList = resolve));
    const from = supabase.client.from.bind(supabase.client);
    vi.spyOn(supabase.client, "from").mockImplementation(((table: "agent_sessions") =>
      table === "agent_sessions"
        ? { select: () => ({ eq: () => ({ order: () => list.then(() => ({ data: [S1, S2], error: null })) }) }) }
        : from(table)) as never);

    const pending = loadAgentPageData(supabase.client, "u1", "s2");

    await vi.waitFor(() => expect(supabase.callsFor("agent_messages")).toHaveLength(1));
    answerList();
    expect((await pending)?.activeSessionId).toBe("s2");
  });

  it("returns the sessions even when the chat fails, and rejects only the chat", async () => {
    supabase.queue("agent_sessions", { data: [S1], error: null });
    supabase.queue("agent_messages", { data: null, error: new Error("messages failed") });

    const data = await loadAgentPageData(supabase.client, "u1", undefined);

    expect(data?.sessions).toEqual([S1]);
    await expect(data!.chat).rejects.toThrow("messages failed");
  });

  it("doesn't open the messages of the other role's session", async () => {
    supabase.queue("agent_sessions", { data: [{ ...S1, role: "company" }], error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined, { role: "applicant" });

    expect(data?.sessions).toEqual([S1]);
    expect(await data!.chat).toEqual({ messages: [], feedback: {} });
    expect(supabase.callsFor("agent_messages")).toHaveLength(0);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("list failed") });

    await expect(loadAgentPageData(supabase.client, "u1", undefined)).rejects.toThrow(
      "list failed",
    );
  });

  it("throws when creating the first session fails", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });
    supabase.queue("agent_sessions", { data: null, error: new Error("insert failed") });

    await expect(loadAgentPageData(supabase.client, "u1", undefined)).rejects.toThrow(
      "insert failed",
    );
  });

  it("lists and creates only company sessions for a company user", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });
    supabase.queue("agent_sessions", { data: S1, error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined, { role: "company" });

    expect(data?.activeSessionId).toBe("s1");
    const [list, insert] = supabase.callsFor("agent_sessions");
    expect(list.chain).toContainEqual({ method: "eq", args: ["role", "company"] });
    expect(insert.chain[0]).toEqual({ method: "insert", args: [{ user_id: "u1", role: "company" }] });
  });
});
