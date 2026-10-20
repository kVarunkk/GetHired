import { beforeEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  countUserMessagesToday,
  loadPromptProfile,
  loadSession,
  setSessionTitle,
  touchSession,
  truncateAfter,
  upsertMessages,
} from "./persistence";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

let supabase: SupabaseMock;

const SESSION = {
  id: "s1",
  user_id: "u1",
  title: "Remote React jobs",
  summary: null,
  summary_upto_message_id: null,
  created_at: "2026-10-11T00:00:00.000Z",
  updated_at: "2026-10-11T00:00:00.000Z",
};

const userMessage: UIMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "find remote react jobs" }],
};

const assistantMessage: UIMessage = {
  id: "m2",
  role: "assistant",
  parts: [{ type: "text", text: "Here are 3 jobs." }],
  metadata: { model: "gemini" },
};

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("loadSession with a role (RA spec §3)", () => {
  it("filters company sessions by role", async () => {
    supabase.queue("agent_sessions", { data: { ...SESSION, role: "company" }, error: null });
    supabase.queue("agent_messages", { data: [], error: null });

    const result = await loadSession(supabase.client, "u1", "s1", { role: "company" });

    expect(result?.session.id).toBe("s1");
    expect(supabase.callsFor("agent_sessions")[0].chain).toContainEqual({
      method: "eq",
      args: ["role", "company"],
    });
  });

  it("returns null for a session of the other role", async () => {
    supabase.queue("agent_sessions", { data: { ...SESSION, role: "company" }, error: null });

    expect(await loadSession(supabase.client, "u1", "s1", { role: "applicant" })).toBeNull();
    expect(supabase.callsFor("agent_messages")).toHaveLength(0);
  });

  it("keeps the applicant's query as it was", async () => {
    supabase.queue("agent_sessions", { data: { ...SESSION, role: "applicant" }, error: null });
    supabase.queue("agent_messages", { data: [], error: null });

    expect(await loadSession(supabase.client, "u1", "s1", { role: "applicant" })).not.toBeNull();
    expect(supabase.callsFor("agent_sessions")[0].chain).not.toContainEqual({
      method: "eq",
      args: ["role", "applicant"],
    });
  });
});

describe("loadSession", () => {
  it("returns the session and its messages ordered by seq", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });
    supabase.queue("agent_messages", {
      data: [
        { id: "m1", role: "user", parts: userMessage.parts, metadata: null },
        { id: "m2", role: "assistant", parts: assistantMessage.parts, metadata: { model: "gemini" } },
      ],
      error: null,
    });

    const result = await loadSession(supabase.client, "u1", "s1");

    expect(result).toEqual({ session: SESSION, messages: [userMessage, assistantMessage] });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "select", args: ["*"] },
      { method: "eq", args: ["id", "s1"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("agent_messages")[0].chain).toEqual([
      { method: "select", args: ["id, role, parts, metadata"] },
      { method: "eq", args: ["session_id", "s1"] },
      { method: "order", args: ["seq", { ascending: true }] },
    ]);
  });

  it("returns null for a missing or foreign session without loading messages", async () => {
    supabase.queue("agent_sessions", { data: null, error: null });

    expect(await loadSession(supabase.client, "u1", "s404")).toBeNull();
    expect(supabase.callsFor("agent_messages")).toHaveLength(0);
  });

  it("returns an empty message list for a new session", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });

    expect(await loadSession(supabase.client, "u1", "s1")).toEqual({
      session: SESSION,
      messages: [],
    });
  });

  it("throws database errors", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });
    supabase.queue("agent_messages", { data: null, error: new Error("messages down") });

    await expect(loadSession(supabase.client, "u1", "s1")).rejects.toThrow("messages down");
  });

  it("throws session lookup errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("sessions down") });

    await expect(loadSession(supabase.client, "u1", "s1")).rejects.toThrow("sessions down");
  });
});

describe("truncateAfter", () => {
  beforeEach(() => {
    supabase.queue("agent_messages", { data: { seq: 7 }, error: null });
  });

  it("deletes messages after the given one (regenerate)", async () => {
    await truncateAfter(supabase.client, "s1", "m3", { inclusive: false });

    const [lookup, remove] = supabase.callsFor("agent_messages");
    expect(lookup.chain).toEqual([
      { method: "select", args: ["seq"] },
      { method: "eq", args: ["id", "m3"] },
      { method: "eq", args: ["session_id", "s1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(remove.chain).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["session_id", "s1"] },
      { method: "gt", args: ["seq", 7] },
    ]);
  });

  it("also deletes the given message when inclusive (edit)", async () => {
    await truncateAfter(supabase.client, "s1", "m3", { inclusive: true });

    expect(supabase.callsFor("agent_messages")[1].chain[2]).toEqual({
      method: "gte",
      args: ["seq", 7],
    });
  });

  it("does nothing for an unknown message id", async () => {
    supabase.reset();
    supabase.queue("agent_messages", { data: null, error: null });

    await truncateAfter(supabase.client, "s1", "missing", { inclusive: false });

    expect(supabase.callsFor("agent_messages")).toHaveLength(1);
  });

  it("throws database errors", async () => {
    supabase.reset();
    supabase.queue("agent_messages", { data: { seq: 1 }, error: null });
    supabase.queue("agent_messages", { data: null, error: new Error("delete failed") });

    await expect(
      truncateAfter(supabase.client, "s1", "m1", { inclusive: false }),
    ).rejects.toThrow("delete failed");
  });

  it("throws lookup errors", async () => {
    supabase.reset();
    supabase.queue("agent_messages", { data: null, error: new Error("lookup failed") });

    await expect(
      truncateAfter(supabase.client, "s1", "m1", { inclusive: false }),
    ).rejects.toThrow("lookup failed");
  });
});

describe("upsertMessages", () => {
  it("upserts messages by id without touching seq", async () => {
    await upsertMessages(supabase.client, "s1", "u1", [userMessage, assistantMessage]);

    expect(supabase.callsFor("agent_messages")[0].chain).toEqual([
      {
        method: "upsert",
        args: [
          [
            { id: "m1", session_id: "s1", user_id: "u1", role: "user", parts: userMessage.parts, metadata: null },
            {
              id: "m2",
              session_id: "s1",
              user_id: "u1",
              role: "assistant",
              parts: assistantMessage.parts,
              metadata: { model: "gemini" },
            },
          ],
          { onConflict: "id" },
        ],
      },
    ]);
  });

  it("skips the query when there is nothing to save", async () => {
    await upsertMessages(supabase.client, "s1", "u1", []);

    expect(supabase.calls).toEqual([]);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_messages", { data: null, error: new Error("upsert failed") });

    await expect(upsertMessages(supabase.client, "s1", "u1", [userMessage])).rejects.toThrow(
      "upsert failed",
    );
  });
});

describe("countUserMessagesToday", () => {
  it("counts the user's own messages since UTC midnight", async () => {
    supabase.queue("agent_messages", { data: null, error: null, count: 12 });

    const count = await countUserMessagesToday(
      supabase.client,
      "u1",
      new Date("2026-10-11T23:59:59.000+05:30"),
    );

    expect(count).toBe(12);
    expect(supabase.callsFor("agent_messages")[0].chain).toEqual([
      { method: "select", args: ["id", { count: "exact", head: true }] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["role", "user"] },
      { method: "gte", args: ["created_at", "2026-10-11T00:00:00.000Z"] },
    ]);
  });

  it("returns 0 when the count is null", async () => {
    expect(await countUserMessagesToday(supabase.client, "u1", new Date())).toBe(0);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_messages", { data: null, error: new Error("count failed") });

    await expect(countUserMessagesToday(supabase.client, "u1", new Date())).rejects.toThrow(
      "count failed",
    );
  });
});

describe("touchSession", () => {
  it("bumps updated_at on the user's session", async () => {
    await touchSession(supabase.client, "u1", "s1", new Date("2026-10-11T12:00:00.000Z"));

    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "update", args: [{ updated_at: "2026-10-11T12:00:00.000Z" }] },
      { method: "eq", args: ["id", "s1"] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("touch failed") });

    await expect(touchSession(supabase.client, "u1", "s1", new Date())).rejects.toThrow(
      "touch failed",
    );
  });
});

describe("setSessionTitle", () => {
  it("sets the title on the user's session", async () => {
    await setSessionTitle(supabase.client, "u1", "s1", "Remote React jobs");

    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "update", args: [{ title: "Remote React jobs" }] },
      { method: "eq", args: ["id", "s1"] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("title failed") });

    await expect(setSessionTitle(supabase.client, "u1", "s1", "t")).rejects.toThrow(
      "title failed",
    );
  });
});

describe("loadPromptProfile", () => {
  it("loads the profile fields used in the system prompt", async () => {
    supabase.queue("user_info", { data: { full_name: "Ada" }, error: null });

    expect(await loadPromptProfile(supabase.client, "u1")).toEqual({ full_name: "Ada" });
    expect(supabase.callsFor("user_info")[0].chain).toEqual([
      {
        method: "select",
        args: [
          "full_name, ai_credits, desired_roles, preferred_locations, min_salary, max_salary, salary_currency, experience_years, top_skills, job_type, visa_sponsorship_required, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, filled",
        ],
      },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("returns null without a profile", async () => {
    expect(await loadPromptProfile(supabase.client, "u1")).toBeNull();
  });

  it("throws database errors", async () => {
    supabase.queue("user_info", { data: null, error: new Error("profile failed") });

    await expect(loadPromptProfile(supabase.client, "u1")).rejects.toThrow("profile failed");
  });
});
