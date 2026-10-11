import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryTools } from "./memory";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { deleteMemory, resolveMemoryRef, upsertMemory } from "@/helpers/agent/memory";
import { AGENT_MEMORY_MAX_CHARS } from "../config";

vi.mock("@/helpers/agent/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/agent/memory")>()),
  upsertMemory: vi.fn(),
  deleteMemory: vi.fn(),
  resolveMemoryRef: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const MEMORY_ID = "44444444-4444-4444-8444-444444444444";
const REF = "44444444";

const savedRow = (content: string) => ({
  id: MEMORY_ID,
  content,
  category: "preference" as const,
  source_session_id: "s1",
  created_at: "c",
  updated_at: "u",
});

let supabase: SupabaseMock;
let tools: ReturnType<typeof createMemoryTools>;

beforeEach(() => {
  supabase = createSupabaseMock();
  tools = createMemoryTools(toolContext(supabase.client));
  vi.mocked(resolveMemoryRef).mockResolvedValue(MEMORY_ID);
});

describe("saveMemory tool", () => {
  it("updates a memory by its short id, with the session id from ctx", async () => {
    vi.mocked(upsertMemory).mockResolvedValue({
      ok: true,
      status: "updated",
      memory: savedRow("Hybrid is fine"),
    });

    const result = await execTool(tools.saveMemory, {
      content: "Hybrid is fine",
      category: "preference",
      memoryId: REF,
    });

    expect(resolveMemoryRef).toHaveBeenCalledWith(supabase.client, "u1", REF);
    expect(upsertMemory).toHaveBeenCalledWith(supabase.client, "u1", {
      content: "Hybrid is fine",
      category: "preference",
      memoryId: MEMORY_ID,
      sessionId: "s1",
    });
    // Results use the same short id the prompt shows.
    expect(result).toEqual({
      status: "updated",
      memory: { id: REF, category: "preference", content: "Hybrid is fine" },
    });
  });

  it("creates a memory without resolving an id", async () => {
    vi.mocked(upsertMemory).mockResolvedValue({
      ok: true,
      status: "created",
      memory: savedRow("Avoid crypto"),
    });

    await execTool(tools.saveMemory, { content: "Avoid crypto", category: "preference" });

    expect(resolveMemoryRef).not.toHaveBeenCalled();
    expect(vi.mocked(upsertMemory).mock.calls[0][2]).toMatchObject({ memoryId: undefined });
  });

  it("reports an unknown short id instead of creating a new memory", async () => {
    vi.mocked(resolveMemoryRef).mockResolvedValue(null);

    expect(
      await execTool(tools.saveMemory, { content: "x", category: "fact", memoryId: "deadbeef" }),
    ).toEqual({ error: "Memory not found." });
    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it("returns helper errors to the model", async () => {
    vi.mocked(upsertMemory).mockResolvedValue({ ok: false, error: "Memory limit of 30 reached." });

    expect(await execTool(tools.saveMemory, { content: "x", category: "fact" })).toEqual({
      error: "Memory limit of 30 reached.",
    });
  });

  it("accepts a full id copied from an older tool result", async () => {
    expect(
      (await validateInput(tools.saveMemory, { content: "x", category: "fact", memoryId: MEMORY_ID }))
        .success,
    ).toBe(true);
  });

  it.each([
    [{ content: "", category: "fact" }],
    [{ content: "x".repeat(AGENT_MEMORY_MAX_CHARS + 1), category: "fact" }],
    [{ content: "x", category: "secret" }],
    [{ content: "x", category: "fact", memoryId: "not-an-id" }],
  ])("rejects invalid input %j", async (input) => {
    expect((await validateInput(tools.saveMemory, input)).success).toBe(false);
  });
});

describe("deleteMemory tool", () => {
  it("deletes a memory by its short id", async () => {
    vi.mocked(deleteMemory).mockResolvedValue({ ok: true });

    expect(await execTool(tools.deleteMemory, { memoryId: REF })).toEqual({
      memoryId: REF,
      deleted: true,
    });
    expect(deleteMemory).toHaveBeenCalledWith(supabase.client, "u1", MEMORY_ID);
  });

  it("reports an unknown short id", async () => {
    vi.mocked(resolveMemoryRef).mockResolvedValue(null);

    expect(await execTool(tools.deleteMemory, { memoryId: "deadbeef" })).toEqual({
      error: "Memory not found.",
    });
    expect(deleteMemory).not.toHaveBeenCalled();
  });

  it("returns helper errors to the model", async () => {
    vi.mocked(deleteMemory).mockResolvedValue({ ok: false, error: "Memory not found." });

    expect(await execTool(tools.deleteMemory, { memoryId: REF })).toEqual({
      error: "Memory not found.",
    });
  });
});

describe("memory limits", () => {
  it("keeps memories short: at most 30, each up to 200 characters", async () => {
    const config = await import("../config");

    expect(config.AGENT_MAX_MEMORIES).toBe(30);
    expect(config.AGENT_MEMORY_MAX_CHARS).toBe(200);
  });
});
