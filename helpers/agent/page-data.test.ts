import { beforeEach, describe, expect, it } from "vitest";
import { loadAgentPageData } from "./page-data";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

const S1 = { id: "s1", title: "Newest", updated_at: "2026-10-11T00:00:00.000Z" };
const S2 = { id: "s2", title: "Older", updated_at: "2026-10-10T00:00:00.000Z" };
const FULL = (s: typeof S1) => ({ ...s, user_id: "u1", summary: null, summary_upto_message_id: null, created_at: "c" });

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("loadAgentPageData", () => {
  it("opens the requested session when it belongs to the user", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_sessions", { data: FULL(S2), error: null });
    supabase.queue("agent_messages", {
      data: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null }],
      error: null,
    });

    const data = await loadAgentPageData(supabase.client, "u1", "s2");

    expect(data).toEqual({
      sessions: [S1, S2],
      activeSessionId: "s2",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "select", args: ["id, title, updated_at"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "order", args: ["updated_at", { ascending: false }] },
    ]);
  });

  it("falls back to the newest session for an unknown or missing id", async () => {
    supabase.queue("agent_sessions", { data: [S1, S2], error: null });
    supabase.queue("agent_sessions", { data: FULL(S1), error: null });

    const data = await loadAgentPageData(supabase.client, "u1", "someone-elses");

    expect(data.activeSessionId).toBe("s1");
    expect(data.messages).toEqual([]);
  });

  it("creates a first session for new users", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });
    supabase.queue("agent_sessions", { data: { id: "s9", title: "New chat", updated_at: "now" }, error: null });
    supabase.queue("agent_sessions", { data: FULL({ id: "s9", title: "New chat", updated_at: "now" }), error: null });

    const data = await loadAgentPageData(supabase.client, "u1", undefined);

    expect(data.sessions).toEqual([{ id: "s9", title: "New chat", updated_at: "now" }]);
    expect(data.activeSessionId).toBe("s9");
    expect(supabase.callsFor("agent_sessions")[1].chain).toEqual([
      { method: "insert", args: [{ user_id: "u1" }] },
      { method: "select", args: ["id, title, updated_at"] },
      { method: "single", args: [] },
    ]);
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
});
