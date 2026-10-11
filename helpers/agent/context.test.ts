import { describe, expect, it } from "vitest";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import {
  dropAbandonedToolCalls,
  messagesToSummarise,
  needsSummary,
  selectContextMessages,
  stubToolOutput,
} from "./context";

const user = (id: string, text = `question ${id}`): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const jobsOutput = (n: number) => ({
  jobs: Array.from({ length: n }, (_, i) => ({ id: `j${i + 1}`, title: `Job ${i + 1}` })),
});

const toolPart = (toolName: string, output: unknown, state = "output-available") =>
  ({
    type: `tool-${toolName}`,
    toolCallId: `call-${toolName}`,
    state,
    input: {},
    ...(state === "output-available" ? { output } : {}),
  }) as ToolUIPart;

const assistant = (id: string, parts: UIMessage["parts"] = []): UIMessage => ({
  id,
  role: "assistant",
  parts: [...parts, { type: "text", text: `answer ${id}` }],
});

/** n turns, each a user message plus an assistant message that ran searchJobs. */
const conversation = (turns: number): UIMessage[] =>
  Array.from({ length: turns }, (_, i) => [
    user(`u${i + 1}`),
    assistant(`a${i + 1}`, [toolPart("searchJobs", jobsOutput(2))]),
  ]).flat();

const OPTIONS = { window: 20, fullToolTurns: 4 };

const outputOf = (message: UIMessage) =>
  (message.parts.find((p) => p.type.startsWith("tool-")) as { output?: unknown }).output;

describe("stubToolOutput", () => {
  it("summarises list results with a count and the first ids", () => {
    expect(stubToolOutput(toolPart("searchJobs", jobsOutput(3)))).toBe(
      "[searchJobs returned 3 jobs: j1, j2, j3]",
    );
  });

  it("lists at most 10 ids", () => {
    expect(stubToolOutput(toolPart("searchJobs", jobsOutput(12)))).toBe(
      "[searchJobs returned 12 jobs: j1, j2, j3, j4, j5, j6, j7, j8, j9, j10, …]",
    );
  });

  it("handles a top-level array", () => {
    expect(stubToolOutput(toolPart("listResumes", [{ id: "r1" }, { id: "r2" }]))).toBe(
      "[listResumes returned 2 items: r1, r2]",
    );
  });

  it("only lists ids for items that have one", () => {
    expect(stubToolOutput(toolPart("listX", { items: [{ id: "a" }, { name: "b" }, null] }))).toBe(
      "[listX returned 3 items: a]",
    );
  });

  it("handles lists without ids", () => {
    expect(stubToolOutput(toolPart("listX", { tags: ["a", "b", "c"] }))).toBe(
      "[listX returned 3 tags]",
    );
  });

  it("reports tool errors", () => {
    expect(stubToolOutput(toolPart("saveJob", { error: "Job not found." }))).toBe(
      "[saveJob failed: Job not found.]",
    );
  });

  it("falls back to a generic stub for other outputs", () => {
    expect(stubToolOutput(toolPart("getMyProfile", { full_name: "Ada" }))).toBe(
      "[getMyProfile output omitted]",
    );
    expect(stubToolOutput(toolPart("getMyProfile", "plain text"))).toBe(
      "[getMyProfile output omitted]",
    );
  });

  it("treats parts without output as omitted", () => {
    expect(stubToolOutput(toolPart("startResumeReview", undefined, "approval-requested"))).toBe(
      "[startResumeReview output omitted]",
    );
  });

  it("uses toolName for dynamic tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "externalSearch",
      toolCallId: "c1",
      state: "output-available",
      input: {},
      output: { error: "down" },
    } as DynamicToolUIPart;

    expect(stubToolOutput(part)).toBe("[externalSearch failed: down]");
  });
});

describe("selectContextMessages", () => {
  it("returns short histories unchanged", () => {
    const messages = conversation(3);

    expect(selectContextMessages(messages, null, OPTIONS)).toEqual(messages);
  });

  it("does not mutate its input", () => {
    const messages = conversation(8);
    const snapshot = structuredClone(messages);

    selectContextMessages(messages, "a1", { window: 6, fullToolTurns: 1 });

    expect(messages).toEqual(snapshot);
  });

  it("drops messages already folded into the summary", () => {
    const result = selectContextMessages(conversation(3), "a1", OPTIONS);

    expect(result.map((m) => m.id)).toEqual(["u2", "a2", "u3", "a3"]);
  });

  it("uses all messages when uptoId is unknown", () => {
    const messages = conversation(2);

    const result = selectContextMessages(messages, "missing", OPTIONS);

    expect(result.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("keeps only the last `window` messages", () => {
    const result = selectContextMessages(conversation(10), null, {
      window: 6,
      fullToolTurns: 4,
    });

    expect(result.map((m) => m.id)).toEqual(["u8", "a8", "u9", "a9", "u10", "a10"]);
  });

  it("drops leading non-user messages after windowing", () => {
    const result = selectContextMessages(conversation(10), null, {
      window: 5,
      fullToolTurns: 4,
    });

    expect(result.map((m) => m.id)).toEqual(["u9", "a9", "u10", "a10"]);
  });

  it("returns nothing when the window holds no user message", () => {
    const result = selectContextMessages([user("u1"), assistant("a1")], null, {
      window: 1,
      fullToolTurns: 4,
    });

    expect(result).toEqual([]);
  });

  it("stubs tool outputs older than the last `fullToolTurns` turns", () => {
    const result = selectContextMessages(conversation(6), null, OPTIONS);
    const byId = Object.fromEntries(result.map((m) => [m.id, m]));

    expect(outputOf(byId.a1)).toBe("[searchJobs returned 2 jobs: j1, j2]");
    expect(outputOf(byId.a2)).toBe("[searchJobs returned 2 jobs: j1, j2]");
    for (const id of ["a3", "a4", "a5", "a6"]) {
      expect(outputOf(byId[id])).toEqual(jobsOutput(2));
    }
  });

  it("leaves text and non-final tool parts alone when stubbing", () => {
    const messages = [
      user("u1"),
      assistant("a1", [toolPart("startResumeReview", undefined, "approval-requested")]),
      ...conversation(4).map((m) => ({ ...m, id: `x-${m.id}` })),
    ];

    const result = selectContextMessages(messages, null, OPTIONS);

    expect(result[1]).toEqual(messages[1]);
  });
});

describe("needsSummary", () => {
  const messages = conversation(20); // 40 messages

  it("is false at exactly `trigger` unsummarised messages", () => {
    expect(needsSummary(messages, "a5", 30)).toBe(false);
  });

  it("is true at `trigger + 1`", () => {
    expect(needsSummary(messages, "u5", 30)).toBe(true);
  });

  it("counts every message when nothing is summarised yet", () => {
    expect(needsSummary(messages, null, 39)).toBe(true);
    expect(needsSummary(messages, null, 40)).toBe(false);
  });
});

describe("messagesToSummarise", () => {
  const messages = conversation(20);

  it("returns unsummarised messages except the last `window`", () => {
    const result = messagesToSummarise(messages, "a5", { window: 20 });

    expect(result.map((m) => m.id)).toEqual([
      "u6", "a6", "u7", "a7", "u8", "a8", "u9", "a9", "u10", "a10",
    ]);
  });

  it("returns nothing when everything fits in the window", () => {
    expect(messagesToSummarise(messages, "a15", { window: 20 })).toEqual([]);
  });
});

describe("dropAbandonedToolCalls", () => {
  const pending = (state: string, toolName = "startResumeReview") =>
    ({
      type: `tool-${toolName}`,
      toolCallId: `c-${state}`,
      state,
      input: {},
      ...(state === "approval-requested" ? { approval: { id: "ap" } } : {}),
    }) as ToolUIPart;

  it("removes unfinished tool calls from all but the last message", () => {
    const older = assistant("a1", [
      pending("approval-requested"),
      pending("input-available", "requestResumeUpload"),
      pending("input-streaming"),
      { ...pending("approval-responded"), approval: { id: "ap", approved: true } } as ToolUIPart,
      toolPart("searchJobs", jobsOutput(1)),
    ]);
    const last = assistant("a2", [pending("approval-requested")]);

    const result = dropAbandonedToolCalls([user("u1"), older, user("u2"), last]);

    expect(result[1].parts.map((p) => p.type)).toEqual(["tool-searchJobs", "text"]);
    expect(result[3]).toEqual(last);
  });

  it("keeps finished tool calls, including denials and errors", () => {
    const answered = assistant("a1", [
      { ...pending("output-denied"), approval: { id: "ap", approved: false } } as ToolUIPart,
      { ...pending("output-error"), errorText: "failed" } as ToolUIPart,
    ]);
    const messages = [answered, user("u2")];

    expect(dropAbandonedToolCalls(messages)).toEqual(messages);
  });

  it("returns [] for no messages", () => {
    expect(dropAbandonedToolCalls([])).toEqual([]);
  });
});
