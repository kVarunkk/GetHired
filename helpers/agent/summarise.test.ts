import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { ToolUIPart, UIMessage } from "ai";
import { generateSessionTitle, summariseSession } from "./summarise";
import { AGENT_TITLE_MODEL } from "./config";
import { mockGenerateModel } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { google } from "@ai-sdk/google";

vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));

const user = (id: string, text = `question ${id}`): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistant = (id: string, parts: UIMessage["parts"] = []): UIMessage => ({
  id,
  role: "assistant",
  parts: [...parts, { type: "text", text: `answer ${id}` }],
});

/** 2n messages: u1, a1, u2, a2, ... */
const conversation = (turns: number) =>
  Array.from({ length: turns }, (_, i) => [user(`u${i + 1}`), assistant(`a${i + 1}`)]).flat();

const failingModel = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("model down");
    },
  });

const promptOf = (model: MockLanguageModelV4) => JSON.stringify(model.doGenerateCalls[0].prompt);

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("summariseSession", () => {
  const base = { sessionId: "s1", userId: "u1", summary: null, uptoId: null };

  it("does nothing when the session is under the trigger", async () => {
    const model = mockGenerateModel("unused");

    const result = await summariseSession(
      supabase.client,
      { ...base, messages: conversation(15) },
      { model },
    );

    expect(result).toEqual({ updated: false });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(supabase.calls).toEqual([]);
  });

  it("folds the messages outside the context window into the summary", async () => {
    const model = mockGenerateModel("  User wants remote React roles in Bengaluru.  ");

    const result = await summariseSession(
      supabase.client,
      { ...base, messages: conversation(20) },
      { model },
    );

    expect(result).toEqual({ updated: true, summary: "User wants remote React roles in Bengaluru." });
    expect(supabase.callsFor("agent_sessions")).toHaveLength(1);
    expect(supabase.callsFor("agent_sessions")[0].chain).toEqual([
      {
        method: "update",
        args: [
          {
            summary: "User wants remote React roles in Bengaluru.",
            summary_upto_message_id: "a10",
          },
        ],
      },
      { method: "eq", args: ["id", "s1"] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);

    const prompt = promptOf(model);
    expect(prompt).toContain("User: question u1");
    expect(prompt).toContain("Assistant: answer a10");
    expect(prompt).not.toContain("question u11");
    expect(prompt).toContain("No previous summary.");
  });

  it("merges with the previous summary and only sends newer messages", async () => {
    const model = mockGenerateModel("merged");

    await summariseSession(
      supabase.client,
      { ...base, summary: "Earlier: likes Go.", uptoId: "a5", messages: conversation(30) },
      { model },
    );

    const prompt = promptOf(model);
    expect(prompt).toContain("<previous_summary>\\nEarlier: likes Go.\\n</previous_summary>");
    expect(prompt).not.toContain("question u5\\n");
    expect(prompt).toContain("User: question u6");
    expect(prompt).toContain("Assistant: answer a20");
    expect(prompt).not.toContain("question u21");
    expect(supabase.callsFor("agent_sessions")[0].chain[0].args[0]).toEqual({
      summary: "merged",
      summary_upto_message_id: "a20",
    });
  });

  it("renders tool calls as stubs in the transcript", async () => {
    const model = mockGenerateModel("s");
    const messages = conversation(20);
    messages[1] = assistant("a1", [
      {
        type: "tool-searchJobs",
        toolCallId: "c1",
        state: "output-available",
        input: {},
        output: { jobs: [{ id: "j1" }, { id: "j2" }] },
      } as ToolUIPart,
    ]);

    await summariseSession(supabase.client, { ...base, messages }, { model });

    expect(promptOf(model)).toContain("Assistant: [searchJobs returned 2 jobs: j1, j2] answer a1");
  });

  it("skips non-text parts and messages with no text", async () => {
    const model = mockGenerateModel("s");
    const messages = conversation(20);
    messages[1] = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "step-start" }, { type: "text", text: "answer a1" }],
    };
    messages[3] = { id: "a2", role: "assistant", parts: [{ type: "step-start" }] };

    await summariseSession(supabase.client, { ...base, messages }, { model });

    const prompt = promptOf(model);
    expect(prompt).toContain("Assistant: answer a1\\nUser: question u2\\nUser: question u3");
  });

  it("throws model errors without updating", async () => {
    await expect(
      summariseSession(
        supabase.client,
        { ...base, messages: conversation(20) },
        { model: failingModel() },
      ),
    ).rejects.toThrow("model down");
    expect(supabase.calls).toEqual([]);
  });

  it("throws database errors", async () => {
    supabase.queue("agent_sessions", { data: null, error: new Error("update failed") });

    await expect(
      summariseSession(
        supabase.client,
        { ...base, messages: conversation(20) },
        { model: mockGenerateModel("s") },
      ),
    ).rejects.toThrow("update failed");
  });

  it("defaults to the title model", async () => {
    vi.mocked(google).mockReturnValue(mockGenerateModel("s") as never);

    await summariseSession(supabase.client, { ...base, messages: conversation(20) });

    expect(google).toHaveBeenCalledWith(AGENT_TITLE_MODEL);
  });
});

describe("generateSessionTitle", () => {
  const messages = [user("u1", "Find me remote React jobs in Bengaluru"), assistant("a1")];

  it("returns a cleaned-up title from the first user message", async () => {
    const model = mockGenerateModel('  "Remote React   jobs, Bengaluru"\n');

    expect(await generateSessionTitle(messages, { model })).toBe("Remote React jobs, Bengaluru");
    expect(promptOf(model)).toContain("Find me remote React jobs in Bengaluru");
  });

  it("caps titles at 80 characters", async () => {
    const title = await generateSessionTitle(messages, {
      model: mockGenerateModel("x".repeat(120)),
    });

    expect(title).toHaveLength(80);
  });

  it("falls back to 'New chat' on model errors", async () => {
    expect(await generateSessionTitle(messages, { model: failingModel() })).toBe("New chat");
  });

  it("falls back to 'New chat' for an empty title", async () => {
    expect(await generateSessionTitle(messages, { model: mockGenerateModel(' "" ') })).toBe(
      "New chat",
    );
  });

  it("falls back to 'New chat' without calling the model when there is no user text", async () => {
    const model = mockGenerateModel("unused");

    expect(await generateSessionTitle([assistant("a1")], { model })).toBe("New chat");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("defaults to the title model", async () => {
    vi.mocked(google).mockReturnValue(mockGenerateModel("Title") as never);

    expect(await generateSessionTitle(messages)).toBe("Title");
    expect(google).toHaveBeenCalledWith(AGENT_TITLE_MODEL);
  });
});

describe("telemetry (REQ-025)", () => {
  const fakeIntegration = () => ({ onStart: vi.fn() });

  it("passes the title's telemetry options to the model call", async () => {
    const integration = fakeIntegration();

    await generateSessionTitle([user("u1", "react jobs")], {
      model: mockGenerateModel("React jobs"),
      telemetry: { functionId: "agent-title", integrations: [integration] },
    });

    expect(integration.onStart).toHaveBeenCalledWith(
      expect.objectContaining({ functionId: "agent-title" }),
    );
  });

  it("passes the summary's telemetry options to the model call", async () => {
    const integration = fakeIntegration();

    await summariseSession(
      supabase.client,
      { sessionId: "s1", userId: "u1", summary: null, uptoId: null, messages: conversation(20) },
      {
        model: mockGenerateModel("summary"),
        telemetry: { functionId: "agent-summary", integrations: [integration] },
      },
    );

    expect(integration.onStart).toHaveBeenCalledWith(
      expect.objectContaining({ functionId: "agent-summary" }),
    );
  });
});
