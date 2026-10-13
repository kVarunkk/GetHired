import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import {
  DELETE,
  GET as GET_ONE,
  PATCH,
} from "./[session_id]/route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const SESSION = {
  id: SESSION_ID,
  user_id: "u1",
  title: "New chat",
  summary: null,
  summary_upto_message_id: null,
  created_at: "c",
  updated_at: "u",
};

let supabase: SupabaseMock;
const params = (session_id = SESSION_ID) => ({ params: Promise.resolve({ session_id }) });

beforeEach(async () => {
  supabase = createSupabaseMock();
  await setRequestUser(mockUser({ id: "u1" }), supabase.client);
});

describe("auth for every sessions route", () => {
  const calls = {
    "GET /sessions": () => GET(),
    "POST /sessions": () =>
      POST(buildRequest("/api/agent/sessions", { method: "POST", body: {} })),
    "GET /sessions/[id]": () => GET_ONE(buildRequest("/x"), params()),
    "PATCH /sessions/[id]": () =>
      PATCH(buildRequest("/x", { method: "PATCH", body: { title: "t" } }), params()),
    "DELETE /sessions/[id]": () => DELETE(buildRequest("/x", { method: "DELETE" }), params()),
  };

  it.each(Object.entries(calls))("%s returns 401 without a user", async (_name, call) => {
    await setRequestUser(null, supabase.client);
    expect((await call()).status).toBe(401);
  });

  it.each(Object.entries(calls))("%s returns 403 for company users", async (_name, call) => {
    await setRequestUser(mockUser({ type: "company" }), supabase.client);
    expect((await call()).status).toBe(403);
  });
});

describe("GET /api/agent/sessions", () => {
  it("lists the user's sessions, most recent first", async () => {
    supabase.queue("agent_sessions", {
      data: [{ id: SESSION_ID, title: "New chat", updated_at: "u" }],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [{ id: SESSION_ID, title: "New chat", updated_at: "u" }],
    });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "select", args: ["id, title, updated_at"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "order", args: ["updated_at", { ascending: false }] },
    ]);
  });

  it("returns 500 with a generic message on database errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("relation missing") });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong. Please try again." });
  });
});

describe("POST /api/agent/sessions", () => {
  it("creates a session with the default title", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });

    const res = await POST(buildRequest("/api/agent/sessions", { method: "POST", body: {} }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ session: SESSION });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "insert", args: [{ user_id: "u1" }] },
      { method: "select", args: ["id, title, updated_at"] },
      { method: "single", args: [] },
    ]);
  });

  it("accepts a title", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });

    await POST(buildRequest("/x", { method: "POST", body: { title: "  Job hunt  " } }));

    expect(supabase.callsFor("agent_sessions")[0].chain[0]).toEqual({
      method: "insert",
      args: [{ user_id: "u1", title: "Job hunt" }],
    });
  });

  it("works without a body", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });

    const res = await POST(buildRequest("/x", { method: "POST" }));

    expect(res.status).toBe(201);
  });

  it("rejects titles over 80 characters", async () => {
    const res = await POST(buildRequest("/x", { method: "POST", body: { title: "x".repeat(81) } }));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/agent/sessions/[session_id]", () => {
  it("returns the session and its messages", async () => {
    supabase.queue("agent_sessions", { data: SESSION, error: null });
    supabase.queue("agent_messages", {
      data: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null }],
      error: null,
    });

    const res = await GET_ONE(buildRequest("/x"), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      session: SESSION,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    });
    expect(supabase.callsFor("agent_sessions")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", "u1"],
    });
  });

  it("returns 404 for another user's or a missing session", async () => {
    const res = await GET_ONE(buildRequest("/x"), params());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found." });
  });

  it("returns 404 for a malformed id without querying", async () => {
    const res = await GET_ONE(buildRequest("/x"), params("not-a-uuid"));

    expect(res.status).toBe(404);
    expect(supabase.calls).toEqual([]);
  });
});

describe("PATCH /api/agent/sessions/[session_id]", () => {
  it("renames the user's session", async () => {
    supabase.queue("agent_sessions", { data: { ...SESSION, title: "Renamed" }, error: null });

    const res = await PATCH(
      buildRequest("/x", { method: "PATCH", body: { title: " Renamed " } }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { ...SESSION, title: "Renamed" } });
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "update", args: [{ title: "Renamed" }] },
      { method: "eq", args: ["id", SESSION_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "select", args: ["id, title, updated_at"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it.each([[{}], [{ title: "" }], [{ title: "   " }], [{ title: "x".repeat(81) }]])(
    "rejects %j",
    async (body) => {
      const res = await PATCH(buildRequest("/x", { method: "PATCH", body }), params());

      expect(res.status).toBe(400);
      expect(supabase.calls).toEqual([]);
    },
  );

  it("returns 404 when nothing was updated", async () => {
    const res = await PATCH(
      buildRequest("/x", { method: "PATCH", body: { title: "t" } }),
      params(),
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/agent/sessions/[session_id]", () => {
  it("deletes the user's session", async () => {
    supabase.queue("agent_sessions", { data: [{ id: SESSION_ID }], error: null });

    const res = await DELETE(buildRequest("/x", { method: "DELETE" }), params());

    expect(res.status).toBe(204);
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["id", SESSION_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("returns 404 when nothing was deleted", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });

    const res = await DELETE(buildRequest("/x", { method: "DELETE" }), params());

    expect(res.status).toBe(404);
  });
});
