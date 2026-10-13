import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteMemory,
  listMemories,
  memoryRef,
  resolveMemoryRef,
  sanitiseMemoryContent,
  upsertMemory,
} from "./memory";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { AGENT_MAX_MEMORIES, AGENT_MEMORY_MAX_CHARS } from "./config";

let supabase: SupabaseMock;

const row = (id: string, content: string, category = "preference") => ({
  id,
  user_id: "u1",
  content,
  category,
  source_session_id: null,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
});

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("sanitiseMemoryContent", () => {
  it("strips HTML and collapses whitespace", () => {
    expect(sanitiseMemoryContent("  Avoid <b>crypto</b>\n\n companies  ")).toBe(
      "Avoid crypto companies",
    );
  });
});

describe("listMemories", () => {
  it("lists the user's memories, most recently updated first", async () => {
    supabase.queue("agent_memories", { data: [row("m1", "a")], error: null });

    const memories = await listMemories(supabase.client, "u1");

    expect(memories).toEqual([row("m1", "a")]);
    expect(supabase.callsFor("agent_memories")[0].chain).toEqual([
      { method: "select", args: ["id, content, category, source_session_id, created_at, updated_at"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "order", args: ["updated_at", { ascending: false }] },
    ]);
  });

  it("returns [] when there are none", async () => {
    expect(await listMemories(supabase.client, "u1")).toEqual([]);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("db down") });

    await expect(listMemories(supabase.client, "u1")).rejects.toThrow("db down");
  });
});

describe("upsertMemory: create", () => {
  it("inserts a sanitised memory with its source session", async () => {
    supabase.queue("agent_memories", { data: [row("m1", "Something else")], error: null });
    supabase.queue("agent_memories", { data: row("m2", "Avoid crypto companies"), error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: " Avoid <i>crypto</i> companies ",
      category: "preference",
      sessionId: "s1",
    });

    expect(result).toEqual({
      ok: true,
      status: "created",
      memory: row("m2", "Avoid crypto companies"),
    });
    const [lookup, insert] = supabase.callsFor("agent_memories");
    expect(lookup.chain).toEqual([
      { method: "select", args: ["id, content, category, source_session_id, created_at, updated_at"] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
    expect(insert.chain).toEqual([
      {
        method: "insert",
        args: [
          {
            user_id: "u1",
            content: "Avoid crypto companies",
            category: "preference",
            source_session_id: "s1",
          },
        ],
      },
      { method: "select", args: ["id, content, category, source_session_id, created_at, updated_at"] },
      { method: "single", args: [] },
    ]);
  });

  it("returns the existing row for a case- or whitespace-insensitive duplicate", async () => {
    supabase.queue("agent_memories", {
      data: [row("m1", "Avoid crypto companies")],
      error: null,
    });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "avoid   CRYPTO companies",
      category: "preference",
      sessionId: "s1",
    });

    expect(result).toEqual({
      ok: true,
      status: "existing",
      memory: row("m1", "Avoid crypto companies"),
    });
    expect(supabase.callsFor("agent_memories")).toHaveLength(1);
  });

  it("refuses to insert at the memory cap", async () => {
    const existing = Array.from({ length: AGENT_MAX_MEMORIES }, (_, i) => row(`m${i}`, `fact ${i}`));
    supabase.queue("agent_memories", { data: existing, error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "one more",
      category: "fact",
      sessionId: "s1",
    });

    expect(result).toEqual({
      ok: false,
      error: `Memory limit of ${AGENT_MAX_MEMORIES} reached. Update an existing memory with its memoryId or delete one first.`,
    });
    expect(supabase.callsFor("agent_memories")).toHaveLength(1);
  });

  it.each([
    ["empty", "   "],
    ["HTML only", "<br/>"],
    ["too long", "x".repeat(AGENT_MEMORY_MAX_CHARS + 1)],
  ])("rejects %s content without querying", async (_label, content) => {
    const result = await upsertMemory(supabase.client, "u1", {
      content,
      category: "fact",
      sessionId: "s1",
    });

    expect(result).toEqual({
      ok: false,
      error: `Memory content must be between 1 and ${AGENT_MEMORY_MAX_CHARS} characters.`,
    });
    expect(supabase.calls).toEqual([]);
  });

  it("inserts when the lookup returns no rows", async () => {
    supabase.queue("agent_memories", { data: null, error: null });
    supabase.queue("agent_memories", { data: row("m1", "first"), error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "first",
      category: "fact",
      sessionId: "s1",
    });

    expect(result).toMatchObject({ ok: true, status: "created" });
  });

  it("throws lookup errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("lookup failed") });

    await expect(
      upsertMemory(supabase.client, "u1", { content: "x", category: "fact", sessionId: "s1" }),
    ).rejects.toThrow("lookup failed");
  });

  it("accepts content at the length limit", async () => {
    const atLimit = "x".repeat(AGENT_MEMORY_MAX_CHARS);
    supabase.queue("agent_memories", { data: [], error: null });
    supabase.queue("agent_memories", { data: row("m1", atLimit), error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: atLimit,
      category: "fact",
      sessionId: null,
    });

    expect(result).toMatchObject({ ok: true, status: "created" });
  });

  it("throws database errors", async () => {
    supabase.queue("agent_memories", { data: [], error: null });
    supabase.queue("agent_memories", { data: null, error: new Error("insert failed") });

    await expect(
      upsertMemory(supabase.client, "u1", { content: "x", category: "fact", sessionId: "s1" }),
    ).rejects.toThrow("insert failed");
  });
});

describe("upsertMemory: update", () => {
  it("updates the user's memory by id", async () => {
    supabase.queue("agent_memories", { data: row("m1", "Hybrid is fine now"), error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "Hybrid is fine now",
      category: "preference",
      memoryId: "m1",
      sessionId: "s2",
    });

    expect(result).toEqual({
      ok: true,
      status: "updated",
      memory: row("m1", "Hybrid is fine now"),
    });
    expect(supabase.callsFor("agent_memories")[0].chain).toEqual([
      {
        method: "update",
        args: [{ content: "Hybrid is fine now", category: "preference", source_session_id: "s2" }],
      },
      { method: "eq", args: ["id", "m1"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "select", args: ["id, content, category, source_session_id, created_at, updated_at"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("keeps the source session when updated outside a session", async () => {
    supabase.queue("agent_memories", { data: row("m1", "Edited by user"), error: null });

    await upsertMemory(supabase.client, "u1", {
      content: "Edited by user",
      category: "fact",
      memoryId: "m1",
      sessionId: null,
    });

    expect(supabase.callsFor("agent_memories")[0].chain[0]).toEqual({
      method: "update",
      args: [{ content: "Edited by user", category: "fact" }],
    });
  });

  it("returns an error for a missing or foreign memory id", async () => {
    supabase.queue("agent_memories", { data: null, error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "x",
      category: "fact",
      memoryId: "someone-elses",
      sessionId: "s1",
    });

    expect(result).toEqual({ ok: false, error: "Memory not found." });
  });

  it("is not blocked by the cap", async () => {
    supabase.queue("agent_memories", { data: row("m1", "x"), error: null });

    const result = await upsertMemory(supabase.client, "u1", {
      content: "x",
      category: "fact",
      memoryId: "m1",
      sessionId: "s1",
    });

    expect(result).toMatchObject({ ok: true, status: "updated" });
    expect(supabase.callsFor("agent_memories")).toHaveLength(1);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("update failed") });

    await expect(
      upsertMemory(supabase.client, "u1", {
        content: "x",
        category: "fact",
        memoryId: "m1",
        sessionId: "s1",
      }),
    ).rejects.toThrow("update failed");
  });
});

describe("deleteMemory", () => {
  it("deletes the user's own memory", async () => {
    supabase.queue("agent_memories", { data: [{ id: "m1" }], error: null });

    const result = await deleteMemory(supabase.client, "u1", "m1");

    expect(result).toEqual({ ok: true });
    expect(supabase.callsFor("agent_memories")[0].chain).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["id", "m1"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("returns an error when nothing was deleted", async () => {
    supabase.queue("agent_memories", { data: [], error: null });

    expect(await deleteMemory(supabase.client, "u1", "m404")).toEqual({
      ok: false,
      error: "Memory not found.",
    });
  });

  it("throws database errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("delete failed") });

    await expect(deleteMemory(supabase.client, "u1", "m1")).rejects.toThrow("delete failed");
  });
});

describe("memoryRef", () => {
  it("is the first 8 characters of the memory's id", () => {
    expect(memoryRef("3f2a9c1d-0b7e-4c2a-9f1e-1234567890ab")).toBe("3f2a9c1d");
  });
});

describe("resolveMemoryRef", () => {
  const A = "3f2a9c1d-0b7e-4c2a-9f1e-1234567890ab";
  const B = "7b1e0000-0b7e-4c2a-9f1e-1234567890ab";

  it("finds the user's memory with that short id", async () => {
    supabase.queue("agent_memories", { data: [{ id: A }, { id: B }], error: null });

    expect(await resolveMemoryRef(supabase.client, "u1", "3F2A9C1D")).toBe(A);
    expect(supabase.callsFor("agent_memories")[0].chain).toEqual([
      { method: "select", args: ["id"] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
  });

  it("accepts a full id copied from an older tool result", async () => {
    supabase.queue("agent_memories", { data: [{ id: A }], error: null });

    expect(await resolveMemoryRef(supabase.client, "u1", A)).toBe(A);
  });

  it("returns null for an unknown short id", async () => {
    supabase.queue("agent_memories", { data: [{ id: B }], error: null });

    expect(await resolveMemoryRef(supabase.client, "u1", "3f2a9c1d")).toBeNull();
  });

  it("returns null rather than guessing when two memories share the short id", async () => {
    supabase.queue("agent_memories", {
      data: [{ id: A }, { id: "3f2a9c1d-ffff-4fff-8fff-ffffffffffff" }],
      error: null,
    });

    expect(await resolveMemoryRef(supabase.client, "u1", "3f2a9c1d")).toBeNull();
  });

  it("throws database errors", async () => {
    supabase.queue("agent_memories", { data: null, error: new Error("read failed") });

    await expect(resolveMemoryRef(supabase.client, "u1", "3f2a9c1d")).rejects.toThrow("read failed");
  });
});
