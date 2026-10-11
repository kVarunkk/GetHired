import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { DELETE, PATCH } from "./[memory_id]/route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { AGENT_MEMORY_MAX_CHARS } from "@/helpers/agent/config";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const MEMORY_ID = "44444444-4444-4444-8444-444444444444";
const MEMORY = {
  id: MEMORY_ID,
  content: "Avoid crypto companies",
  category: "preference",
  source_session_id: "s1",
  created_at: "c",
  updated_at: "u",
};

let supabase: SupabaseMock;
const params = (memory_id = MEMORY_ID) => ({ params: Promise.resolve({ memory_id }) });
const patch = (body: unknown) =>
  PATCH(buildRequest("/x", { method: "PATCH", body }), params());

beforeEach(async () => {
  supabase = createSupabaseMock();
  await setRequestUser(mockUser({ id: "u1" }), supabase.client);
});

describe("auth for every memories route", () => {
  const calls = {
    "GET /memories": () => GET(),
    "PATCH /memories/[id]": () => patch({ content: "x" }),
    "DELETE /memories/[id]": () => DELETE(buildRequest("/x", { method: "DELETE" }), params()),
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

describe("GET /api/agent/memories", () => {
  it("lists the user's memories", async () => {
    supabase.queue("agent_memories", { data: [MEMORY], error: null });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memories: [MEMORY] });
    expect(supabase.callsFor("agent_memories")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", "u1"],
    });
  });

  it("returns 500 with a generic message on database errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("boom") });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong. Please try again." });
  });
});

describe("PATCH /api/agent/memories/[memory_id]", () => {
  it("updates content and keeps the existing category", async () => {
    supabase.queue("agent_memories", { data: MEMORY, error: null });
    supabase.queue("agent_memories", { data: { ...MEMORY, content: "Crypto is fine" }, error: null });

    const res = await patch({ content: "Crypto is fine" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memory: { ...MEMORY, content: "Crypto is fine" } });
    const [lookup, update] = supabase.callsFor("agent_memories");
    expect(lookup.chain).toEqual([
      { method: "select", args: ["content, category"] },
      { method: "eq", args: ["id", MEMORY_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(update.chain[0]).toEqual({
      method: "update",
      args: [{ content: "Crypto is fine", category: "preference" }],
    });
  });

  it("updates the category alone", async () => {
    supabase.queue("agent_memories", { data: MEMORY, error: null });
    supabase.queue("agent_memories", { data: { ...MEMORY, category: "fact" }, error: null });

    await patch({ category: "fact" });

    expect(supabase.callsFor("agent_memories")[1].chain[0]).toEqual({
      method: "update",
      args: [{ content: "Avoid crypto companies", category: "fact" }],
    });
  });

  it.each([[{}], [{ category: "secret" }], [{ content: "x".repeat(AGENT_MEMORY_MAX_CHARS + 1) }]])(
    "rejects %j",
    async (body) => {
      const res = await patch(body);

      expect(res.status).toBe(400);
      expect(supabase.calls).toEqual([]);
    },
  );

  it("returns 400 for content that is empty after sanitising", async () => {
    supabase.queue("agent_memories", { data: MEMORY, error: null });

    const res = await patch({ content: "<br/>" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `Memory content must be between 1 and ${AGENT_MEMORY_MAX_CHARS} characters.`,
    });
  });

  it("returns 404 for another user's or a missing memory", async () => {
    const res = await patch({ content: "x" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Memory not found." });
  });

  it("returns 404 for a malformed id", async () => {
    const res = await PATCH(
      buildRequest("/x", { method: "PATCH", body: { content: "x" } }),
      params("nope"),
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/agent/memories/[memory_id]", () => {
  it("deletes the user's memory", async () => {
    supabase.queue("agent_memories", { data: [{ id: MEMORY_ID }], error: null });

    const res = await DELETE(buildRequest("/x", { method: "DELETE" }), params());

    expect(res.status).toBe(204);
  });

  it("returns 404 when nothing was deleted", async () => {
    supabase.queue("agent_memories", { data: [], error: null });

    const res = await DELETE(buildRequest("/x", { method: "DELETE" }), params());

    expect(res.status).toBe(404);
  });
});
