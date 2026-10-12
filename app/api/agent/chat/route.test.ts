import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessage } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { mockModel, textStream, toolCallStream } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateSessionTitle, summariseSession } from "@/helpers/agent/summarise";
import { generateFollowUps } from "@/helpers/agent/suggestions";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { agentTelemetry, flushAgentTraces } from "@/helpers/agent/telemetry";
import {
  AGENT_CONTENT_FILTER_MESSAGE,
  AGENT_DAILY_MESSAGE_CAP,
  AGENT_MAX_REGENERATIONS,
  AGENT_MAX_STEPS,
  AGENT_MODEL,
  AGENT_SAFETY_SETTINGS,
} from "@/helpers/agent/config";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));
vi.mock("@/helpers/agent/summarise", () => ({
  generateSessionTitle: vi.fn(),
  summariseSession: vi.fn(),
}));
vi.mock("@/helpers/agent/suggestions", () => ({ generateFollowUps: vi.fn() }));
vi.mock("@/helpers/jobs/search-jobs", () => ({ searchJobs: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/agent/telemetry", () => ({
  agentTelemetry: vi.fn(),
  flushAgentTraces: vi.fn(),
}));

const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const SESSION = {
  id: SESSION_ID,
  user_id: "u1",
  title: "New chat",
  summary: null as string | null,
  summary_upto_message_id: null as string | null,
  created_at: "c",
  updated_at: "u",
};

const text = (id: string, role: "user" | "assistant", value: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});
const asRow = (m: UIMessage) => ({ id: m.id, role: m.role, parts: m.parts, metadata: m.metadata ?? null });

let supabase: SupabaseMock;
let service: SupabaseMock;
let model: MockLanguageModelV4;

const chat = (body: unknown) =>
  POST(buildRequest("/api/agent/chat", { method: "POST", body }));

const submit = (message: UIMessage) =>
  chat({ sessionId: SESSION_ID, trigger: "submit-message", message });

/** Queues the reads every accepted request makes, in order. */
function queueSession({
  history = [] as UIMessage[],
  session = SESSION,
  todayCount = 0,
  countCheck = true,
} = {}) {
  supabase.queue("agent_sessions", { data: session, error: null });
  supabase.queue("agent_messages", { data: history.map(asRow), error: null });
  if (countCheck) supabase.queue("agent_messages", { data: null, error: null, count: todayCount });
  supabase.queue("user_info", { data: { full_name: "Ada", ai_credits: 12 }, error: null });
  supabase.queue("agent_memories", {
    data: [{ id: "m1", category: "preference", content: "Avoid crypto companies" }],
    error: null,
  });
}

const upserts = (mock: SupabaseMock) =>
  mock
    .callsFor("agent_messages")
    .filter((c) => c.chain[0].method === "upsert")
    .map((c) => c.chain[0].args[0] as { id: string; role: string; parts: unknown[] }[]);

/**
 * The reply text in an SSE body. The route releases text word by word
 * (smoothStream), so it arrives split over many deltas.
 */
const streamedText = (body: string) =>
  [...body.matchAll(/"type":"text-delta","id":"[^"]+","delta":"([^"]*)"/g)]
    .map((m) => m[1])
    .join("");

/** The prompt the model received on its first call, as text. */
const firstPrompt = () => JSON.stringify(model.doStreamCalls[0].prompt);

beforeEach(async () => {
  supabase = createSupabaseMock();
  service = createSupabaseMock();
  await setRequestUser(mockUser({ id: "u1" }), supabase.client);
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  model = mockModel([textStream("Hello from the agent")]);
  vi.mocked(google).mockReturnValue(model as never);
  vi.mocked(generateSessionTitle).mockResolvedValue("Remote React jobs");
  vi.mocked(summariseSession).mockResolvedValue({ updated: false });
  vi.mocked(generateFollowUps).mockResolvedValue([]);
  // Distinguishable per-call options, so tests can see which call got which.
  vi.mocked(agentTelemetry).mockImplementation((functionId) => ({ isEnabled: false, functionId }));
  vi.mocked(flushAgentTraces).mockResolvedValue(undefined);
});

/** The options agentTelemetry returned for `functionId` in this test. */
const traced = (functionId: string) => ({ isEnabled: false, functionId });
const TRACE_CONTEXT = { sessionId: SESSION_ID, userId: "u1" };

describe("POST /api/agent/chat: guards", () => {
  it("returns 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    expect((await submit(text("u1", "user", "hi"))).status).toBe(401);
  });

  it("returns 403 for company users", async () => {
    await setRequestUser(mockUser({ type: "company" }), supabase.client);

    expect((await submit(text("u1", "user", "hi"))).status).toBe(403);
  });

  it.each([
    ["a missing sessionId", { trigger: "submit-message", message: text("u1", "user", "hi") }],
    ["an unknown trigger", { sessionId: SESSION_ID, trigger: "delete", message: text("u1", "user", "hi") }],
    ["submit without a message", { sessionId: SESSION_ID, trigger: "submit-message" }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await chat(body);

    expect(res.status).toBe(400);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it.each([
    ["non-text parts", { id: "u9", role: "user", parts: [{ type: "file", url: "x", mediaType: "a/b" }] }],
    ["over 4000 characters", text("u9", "user", "x".repeat(4001))],
    ["only whitespace", text("u9", "user", "   ")],
  ])("returns 400 for user messages with %s", async (_label, message) => {
    queueSession();

    const res = await submit(message as UIMessage);

    expect(res.status).toBe(400);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("returns 404 for a missing or foreign session", async () => {
    supabase.queue("agent_sessions", { data: null, error: null });

    const res = await submit(text("u1", "user", "hi"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found." });
  });

  it("allows 20 user messages per day", () => {
    expect(AGENT_DAILY_MESSAGE_CAP).toBe(20);
  });

  it("returns 429 at the daily cap without saving or calling the model", async () => {
    queueSession({ todayCount: AGENT_DAILY_MESSAGE_CAP });

    const res = await submit(text("u1", "user", "hi"));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: `You've reached today's limit of ${AGENT_DAILY_MESSAGE_CAP} messages. Try again tomorrow.`,
    });
    expect(upserts(supabase)).toHaveLength(0);
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("POST /api/agent/chat: a new message", () => {
  it("streams the reply with the system prompt and history", async () => {
    queueSession({ history: [text("u0", "user", "earlier question"), text("a0", "assistant", "earlier answer")] });

    const res = await submit(text("u1", "user", "find remote react jobs"));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(streamedText(body)).toBe("Hello from the agent");
    expect(google).toHaveBeenCalledWith(AGENT_MODEL);
    const prompt = firstPrompt();
    expect(prompt).toContain("GetHired job-search assistant");
    expect(prompt).toContain("[m1] (preference) Avoid crypto companies");
    expect(prompt).toContain("Name: Ada");
    expect(prompt).toContain("earlier answer");
    expect(prompt).toContain("find remote react jobs");
  });

  it("saves the user message before streaming and the reply when it finishes", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    await res.text();

    const [userSave, replySave] = upserts(supabase);
    expect(userSave).toEqual([
      { id: "u1", session_id: SESSION_ID, user_id: "u1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: null },
    ]);
    expect(replySave).toHaveLength(1);
    expect(replySave[0]).toMatchObject({ role: "assistant", session_id: SESSION_ID, user_id: "u1" });
    expect(JSON.stringify(replySave[0].parts)).toContain("Hello from the agent");
    expect(
      supabase.callsFor("agent_sessions").some((c) => c.chain[0].method === "update"),
    ).toBe(true);
  });

  it("follows a finished reply with suggested replies, and saves them", async () => {
    queueSession();
    vi.mocked(generateFollowUps).mockResolvedValue(["Only remote roles", "Save the first job"]);

    const res = await submit(text("u1", "user", "find react jobs"));
    const body = await res.text();

    expect(generateFollowUps).toHaveBeenCalledWith(
      { userText: "find react jobs", replyText: "Hello from the agent" },
      { telemetry: traced("agent-suggestions") },
    );
    expect(body).toContain('"type":"data-suggestions"');
    expect(body.indexOf("data-suggestions")).toBeLessThan(body.indexOf('"type":"finish"'));
    const [, replySave] = upserts(supabase);
    expect(replySave[0].parts).toContainEqual({
      type: "data-suggestions",
      id: "suggestions",
      data: { suggestions: ["Only remote roles", "Save the first job"] },
    });
  });

  it("finishes without a suggestions part when there are none", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    const body = await res.text();

    expect(body).not.toContain("data-suggestions");
    expect(body).toContain('"type":"finish"');
  });

  it("titles a new session and updates the summary after responding", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    expect(generateSessionTitle).not.toHaveBeenCalled();
    await flushAfter();

    const finalMessages = vi.mocked(generateSessionTitle).mock.calls[0][0];
    expect(finalMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(service.callsFor("agent_sessions")[0].chain).toEqual([
      { method: "update", args: [{ title: "Remote React jobs" }] },
      { method: "eq", args: ["id", SESSION_ID] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
    expect(summariseSession).toHaveBeenCalledWith(
      service.client,
      {
        sessionId: SESSION_ID,
        userId: "u1",
        messages: finalMessages,
        summary: null,
        uptoId: null,
      },
      { telemetry: traced("agent-summary") },
    );
    expect(vi.mocked(generateSessionTitle).mock.calls[0][1]).toEqual({
      telemetry: traced("agent-title"),
    });
  });

  it("keeps an existing title", async () => {
    queueSession({ session: { ...SESSION, title: "My search" } });

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    await flushAfter();

    expect(generateSessionTitle).not.toHaveBeenCalled();
    expect(service.callsFor("agent_sessions")).toHaveLength(0);
  });

  it("uses the session summary in the context", async () => {
    queueSession({
      session: { ...SESSION, summary: "Wants remote Go roles.", summary_upto_message_id: "a0" },
      history: [text("u0", "user", "summarised question"), text("a0", "assistant", "summarised answer")],
    });

    const res = await submit(text("u1", "user", "hi"));
    await res.text();

    expect(firstPrompt()).toContain("Wants remote Go roles.");
    expect(firstPrompt()).not.toContain("summarised answer");
  });
});

describe("POST /api/agent/chat: history rules", () => {
  const history = [
    text("u1", "user", "first"),
    text("a1", "assistant", "first answer"),
    text("u2", "user", "second"),
    text("a2", "assistant", "stale answer"),
  ];

  it("truncates from an edited user message and replaces it", async () => {
    queueSession({ history });
    supabase.queue("agent_messages", { data: { seq: 3 }, error: null });

    const res = await submit(text("u2", "user", "second, edited"));
    await res.text();

    const del = supabase.callsFor("agent_messages").find((c) => c.chain[0].method === "delete");
    expect(del?.chain).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["session_id", SESSION_ID] },
      { method: "gte", args: ["seq", 3] },
    ]);
    expect(firstPrompt()).toContain("second, edited");
    expect(firstPrompt()).not.toContain("stale answer");
  });

  it("regenerates from the parent user message and counts the regeneration on it", async () => {
    queueSession({ history });
    supabase.queue("agent_messages", { data: { seq: 3 }, error: null });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "a2" });
    await res.text();

    const lookup = supabase.callsFor("agent_messages").find((c) => c.chain[0].args[0] === "seq");
    expect(lookup?.chain[1]).toEqual({ method: "eq", args: ["id", "u2"] });
    const del = supabase.callsFor("agent_messages").find((c) => c.chain[0].method === "delete");
    expect(del?.chain[2]).toEqual({ method: "gt", args: ["seq", 3] });
    const [parent, reply] = upserts(supabase);
    expect(parent).toEqual([expect.objectContaining({ id: "u2", metadata: { regenerations: 1 } })]);
    expect(reply).toEqual([expect.objectContaining({ role: "assistant" })]);
    expect(firstPrompt()).not.toContain("stale answer");
  });

  it(`refuses a regeneration after ${AGENT_MAX_REGENERATIONS}, without counting or calling the model`, async () => {
    const regenerated = { ...history[2], metadata: { regenerations: AGENT_MAX_REGENERATIONS } };
    queueSession({ history: [history[0], history[1], regenerated, history[3]], countCheck: false });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "a2" });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: `You can regenerate a reply up to ${AGENT_MAX_REGENERATIONS} times.`,
    });
    expect(upserts(supabase)).toHaveLength(0);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("refuses a regeneration once the daily cap is reached", async () => {
    queueSession({ history, todayCount: AGENT_DAILY_MESSAGE_CAP });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "a2" });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: `You've reached today's limit of ${AGENT_DAILY_MESSAGE_CAP} messages. Try again tomorrow.`,
    });
    expect(supabase.callsFor("agent_messages").some((c) => c.chain[0].method === "delete")).toBe(false);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("starts the regeneration count again when a message is edited", async () => {
    const regenerated = { ...history[2], metadata: { regenerations: 2 } };
    queueSession({ history: [history[0], history[1], regenerated, history[3]] });
    supabase.queue("agent_messages", { data: { seq: 3 }, error: null });

    const res = await submit(text("u2", "user", "second, edited"));
    await res.text();

    expect(upserts(supabase)[0]).toEqual([expect.objectContaining({ id: "u2", metadata: null })]);
  });

  it("regenerates the last reply when no messageId is given", async () => {
    queueSession({ history });
    supabase.queue("agent_messages", { data: { seq: 3 }, error: null });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message" });

    expect(res.status).toBe(200);
  });

  it("returns 400 when regenerating an unknown message", async () => {
    queueSession({ history, countCheck: false });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "nope" });

    expect(res.status).toBe(400);
  });

  it("applies an approval response to the stored reply and continues it", async () => {
    const pending: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-startResumeReview",
          toolCallId: "c1",
          state: "approval-requested",
          input: { resumeId: "22222222-2222-4222-8222-222222222222", jobId: "11111111-1111-4111-8111-111111111111" },
          approval: { id: "ap1" },
        },
      ],
    } as UIMessage;
    queueSession({ history: [text("u1", "user", "review my resume"), pending], countCheck: false });
    const denied = {
      ...pending,
      parts: [{ ...pending.parts[0], state: "approval-responded", approval: { id: "ap1", approved: false } }],
    };

    const res = await submit(denied as UIMessage);
    await res.text();

    const [saved] = upserts(supabase);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "a1", role: "assistant" });
    expect(saved[0].parts[0]).toMatchObject({
      state: "approval-responded",
      approval: { id: "ap1", approved: false },
    });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("returns 400 for an assistant message that isn't the latest reply", async () => {
    queueSession({ history, countCheck: false });

    const res = await submit(text("a1", "assistant", "rewritten"));

    expect(res.status).toBe(400);
    expect(upserts(supabase)).toHaveLength(0);
  });
});

describe("POST /api/agent/chat: tracing (REQ-025 – REQ-029)", () => {
  it("traces the chat, suggestions, title and summary with the session and user", async () => {
    queueSession();
    vi.mocked(generateFollowUps).mockResolvedValue(["Only remote roles"]);

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    await flushAfter();

    for (const functionId of ["agent-chat", "agent-suggestions", "agent-title", "agent-summary"]) {
      expect(agentTelemetry).toHaveBeenCalledWith(functionId, TRACE_CONTEXT);
    }
  });

  it("flushes traces before the response stream closes, after the suggestions", async () => {
    queueSession();
    let flushedBeforeEnd = false;
    vi.mocked(flushAgentTraces).mockImplementation(async () => {
      flushedBeforeEnd = true;
    });

    const res = await submit(text("u1", "user", "hi"));
    const body = await res.text();

    // The flush ran while the stream was still open: it happened before
    // res.text() could resolve, and after the follow-ups were generated.
    expect(flushedBeforeEnd).toBe(true);
    expect(body).toContain('"type":"finish"');
    expect(vi.mocked(flushAgentTraces).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(generateFollowUps).mock.invocationCallOrder[0],
    );
  });

  it("flushes again after the background title and summary", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    expect(flushAgentTraces).toHaveBeenCalledTimes(1);

    await flushAfter();

    expect(flushAgentTraces).toHaveBeenCalledTimes(2);
    expect(vi.mocked(flushAgentTraces).mock.invocationCallOrder[1]).toBeGreaterThan(
      vi.mocked(summariseSession).mock.invocationCallOrder[0],
    );
  });
});

describe("POST /api/agent/chat: token usage", () => {
  it("logs each turn's token usage, so context size can be measured", async () => {
    queueSession();
    model = mockModel([toolCallStream("searchJobs", { keywords: ["react"] }), textStream("Found 1 job.")]);
    vi.mocked(google).mockReturnValue(model as never);
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null });

    const res = await submit(text("u1", "user", "react jobs"));
    await res.text();
    await flushAfter();

    // The mock model reports 10 input and 5 output tokens per step; two steps here.
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: "agent_chat_turn",
      distinctId: "u1",
      properties: {
        session_id: SESSION_ID,
        model: AGENT_MODEL,
        steps: 2,
        finish_reason: "stop",
        input_tokens: 20,
        output_tokens: 10,
        cached_input_tokens: null,
        memory_count: 1,
      },
    });
  });

  it("does not fail the reply when the model errors before reporting usage", async () => {
    queueSession();
    vi.mocked(google).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("down");
        },
      }) as never,
    );

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    await flushAfter();

    expect(eventCaptureServer).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/chat: tool loop", () => {
  it("runs tools with the user's context and streams their results", async () => {
    queueSession();
    model = mockModel([toolCallStream("searchJobs", { keywords: ["react"] }), textStream("Found 1 job.")]);
    vi.mocked(google).mockReturnValue(model as never);
    vi.mocked(searchJobs).mockResolvedValue({
      ok: true,
      data: [{ id: "j1", job_name: "React Dev" }],
      totalCount: 1,
      nextCursor: null,
    } as never);

    const res = await submit(text("u1", "user", "react jobs"));
    const body = await res.text();

    expect(searchJobs).toHaveBeenCalledWith(supabase.client, { jobTitleKeywords: "react", limit: 10 });
    expect(body).toContain("tool-output-available");
    expect(body).toContain("React Dev");
    expect(streamedText(body)).toBe("Found 1 job.");
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it(`stops after ${AGENT_MAX_STEPS} steps`, async () => {
    queueSession();
    model = mockModel(
      Array.from({ length: AGENT_MAX_STEPS + 2 }, (_, i) =>
        toolCallStream("listSavedJobs", {}, `call-${i}`),
      ),
    );
    vi.mocked(google).mockReturnValue(model as never);
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null });

    const res = await submit(text("u1", "user", "loop"));
    await res.text();

    expect(model.doStreamCalls).toHaveLength(AGENT_MAX_STEPS);
    // The turn didn't end with an answer, so there is nothing to follow up on.
    expect(generateFollowUps).not.toHaveBeenCalled();
  });

  it("streams a generic error and reports it when the model fails", async () => {
    queueSession();
    vi.mocked(google).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("provider exploded: api key abc123");
        },
      }) as never,
    );

    const res = await submit(text("u1", "user", "hi"));
    const body = await res.text();

    expect(body).toContain("Sorry, something went wrong. Please try again.");
    expect(body).not.toContain("abc123");
    expect(generateFollowUps).not.toHaveBeenCalled();
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "u1",
        properties: expect.objectContaining({ flow: "agent_chat_stream" }),
      }),
    );
  });
});

describe("POST /api/agent/chat: stopped by the user", () => {
  /** Errors the stream once `signal` aborts, as a cancelled fetch does. */
  function failOnAbort(controller: ReadableStreamDefaultController, signal?: AbortSignal) {
    const fail = () => controller.error(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail);
  }

  /**
   * A model whose first step calls searchJobs and whose second streams
   * `partial` and then hangs until the request is aborted, like a real
   * provider call cancelled mid-reply.
   */
  function stallingModel(partial: LanguageModelV4StreamPart[]) {
    const steps = [toolCallStream("searchJobs", { keywords: ["react"] })];
    return new MockLanguageModelV4({
      doStream: async ({ abortSignal }) =>
        steps.shift() ?? {
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              partial.forEach((chunk) => controller.enqueue(chunk));
              failOnAbort(controller, abortSignal);
            },
          }),
        },
    });
  }

  /**
   * Submits, aborts the request once `needle` has streamed (as reply text or
   * raw stream data), and reads to the end.
   */
  async function submitAndStop(needle: string) {
    const controller = new AbortController();
    const res = await POST(
      buildRequest("/api/agent/chat", {
        method: "POST",
        body: { sessionId: SESSION_ID, trigger: "submit-message", message: text("u1", "user", "react jobs") },
        signal: controller.signal,
      }),
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (!body.includes(needle) && !streamedText(body).includes(needle)) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value);
    }
    controller.abort();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      body += decoder.decode(next.value);
    }
    return body;
  }

  beforeEach(() => {
    vi.mocked(searchJobs).mockResolvedValue({
      ok: true,
      data: [{ id: "j1", job_name: "React Dev" }],
      totalCount: 1,
      nextCursor: null,
    } as never);
    vi.mocked(generateFollowUps).mockResolvedValue(["Only remote roles"]);
  });

  it("ends the model call and saves what was shown, marked as stopped", async () => {
    queueSession();
    model = stallingModel([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Here are the first " },
    ]);
    vi.mocked(google).mockReturnValue(model as never);

    await submitAndStop("Here are the first");

    expect(generateFollowUps).not.toHaveBeenCalled();
    const [, replySave] = upserts(supabase);
    expect(replySave).toHaveLength(1);
    const reply = replySave[0] as unknown as UIMessage;
    expect(reply.metadata).toEqual({ stopped: true });
    expect(reply.parts).toContainEqual(
      expect.objectContaining({ type: "tool-searchJobs", state: "output-available" }),
    );
    expect(reply.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: "Here are the first ", state: "done" }),
    );
    expect(JSON.stringify(reply.parts)).not.toContain("data-suggestions");
  });

  it("drops a tool call that hadn't finished", async () => {
    queueSession();
    model = stallingModel([
      { type: "tool-input-start", id: "call-2", toolName: "listSavedJobs" },
      { type: "tool-input-delta", id: "call-2", delta: "{" },
    ]);
    vi.mocked(google).mockReturnValue(model as never);

    await submitAndStop("tool-input-delta");

    const [, replySave] = upserts(supabase);
    const types = (replySave[0].parts as { type: string }[]).map((p) => p.type);
    expect(types).toContain("tool-searchJobs");
    expect(types).not.toContain("tool-listSavedJobs");
  });

  it("saves no reply when nothing had arrived yet", async () => {
    queueSession();
    model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            failOnAbort(controller, abortSignal);
          },
        }),
      }),
    });
    vi.mocked(google).mockReturnValue(model as never);

    await submitAndStop(""); // Stop before any chunk is read.

    expect(upserts(supabase)).toHaveLength(1); // Only the user message.
  });

  it("logs the turn's usage as aborted", async () => {
    queueSession();
    model = stallingModel([{ type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "Partial " }]);
    vi.mocked(google).mockReturnValue(model as never);

    await submitAndStop("Partial");
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ finish_reason: "aborted", steps: 1 }),
      }),
    );
  });
});

describe("POST /api/agent/chat: guardrails (spec §14)", () => {
  it("runs the model with explicit Gemini safety settings (REQ-030)", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    await res.text();

    expect(model.doStreamCalls[0].providerOptions?.google).toEqual({
      safetySettings: [...AGENT_SAFETY_SETTINGS],
    });
  });

  it("asks the user before a profile change, through the approval policy (SEC-012)", async () => {
    queueSession();
    model = mockModel([toolCallStream("updateMyPreferences", { minSalary: 100000 })]);
    vi.mocked(google).mockReturnValue(model as never);

    const res = await submit(text("u1", "user", "set my min salary to 100k"));
    const body = await res.text();

    expect(body).toContain("tool-approval-request");
    expect(supabase.callsFor("user_info").some((c) => c.chain[0].method === "update")).toBe(false);
  });

  it("replaces a reply blocked by the safety filter with a readable message, and saves it", async () => {
    queueSession();
    model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "content-filter", raw: "SAFETY" },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 0, text: 0, reasoning: undefined },
              },
            });
            controller.close();
          },
        }),
      }),
    });
    vi.mocked(google).mockReturnValue(model as never);

    const res = await submit(text("u1", "user", "something harmful"));
    const body = await res.text();

    expect(body).toContain(AGENT_CONTENT_FILTER_MESSAGE);
    expect(generateFollowUps).not.toHaveBeenCalled();
    const reply = upserts(supabase).at(-1)![0];
    expect(reply.role).toBe("assistant");
    expect(reply.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: AGENT_CONTENT_FILTER_MESSAGE }),
    );
  });
});

describe("POST /api/agent/chat: streaming", () => {
  it("releases the model's text word by word, so the reply flows", async () => {
    queueSession();

    const res = await submit(text("u1", "user", "hi"));
    const body = await res.text();

    // The mock model sends "Hello from the agent" as one chunk.
    expect(body.match(/"type":"text-delta"/g)!.length).toBeGreaterThan(1);
    expect(streamedText(body)).toBe("Hello from the agent");
  });
});
