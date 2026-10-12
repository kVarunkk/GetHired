import { createRequire } from "node:module";
import { join } from "node:path";
/**
 * Pins the AI SDK APIs the /agent feature depends on (spec DEP-001, RISK-002),
 * using the test helpers from ./ai. If an SDK upgrade renames or reshapes
 * any of these, this file fails first.
 */
import { describe, expect, it, vi } from "vitest";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  readUIMessageStream,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { mockModel, textStream, toolCallStream } from "./ai";

describe("AI SDK contract", () => {
  it("streams text from a mocked v4 model", async () => {
    const model = mockModel([textStream("Hello from the agent")]);

    const result = streamText({ model, prompt: "hi" });

    expect(await result.text).toBe("Hello from the agent");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("runs a multi-step tool loop: tool call, then final text", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => ({
      jobs: [{ id: "j1", title: `${query} engineer` }],
    }));
    const model = mockModel([
      toolCallStream("searchJobs", { query: "react" }),
      textStream("Found 1 job."),
    ]);

    const result = streamText({
      model,
      prompt: "find react jobs",
      tools: {
        searchJobs: tool({
          description: "Search jobs",
          inputSchema: z.object({ query: z.string() }),
          execute,
        }),
      },
      stopWhen: stepCountIs(5),
    });

    expect(await result.text).toBe("Found 1 job.");
    expect(execute).toHaveBeenCalledWith(
      { query: "react" },
      expect.objectContaining({ toolCallId: "call-1" }),
    );
    expect(await result.steps).toHaveLength(2);
  });

  it("emits a tool-approval-request and does not execute when toolApproval asks the user", async () => {
    const execute = vi.fn(async () => ({ reviewId: "r1" }));
    const model = mockModel([toolCallStream("startResumeReview", { resumeId: "res-1" })]);

    const result = streamText({
      model,
      prompt: "review my resume",
      tools: {
        startResumeReview: tool({
          description: "Start a resume review (costs credits)",
          inputSchema: z.object({ resumeId: z.string() }),
          execute,
        }),
      },
      toolApproval: ({ toolCall }) =>
        toolCall.toolName === "startResumeReview" ? "user-approval" : undefined,
      stopWhen: stepCountIs(5),
    });

    const partTypes: string[] = [];
    for await (const part of result.fullStream) partTypes.push(part.type);

    expect(partTypes).toContain("tool-approval-request");
    expect(execute).not.toHaveBeenCalled();
  });

  it("an automatic denial skips the tool, tells the model, and ends as output-denied in the UI", async () => {
    const execute = vi.fn(async () => ({ jobs: [] }));
    const model = mockModel([
      toolCallStream("naturalLanguageJobSearch", { query: "react" }),
      textStream("I've hit the limit for this message."),
    ]);

    const result = streamText({
      model,
      prompt: "search",
      tools: {
        naturalLanguageJobSearch: tool({
          description: "AI job search (costs credits)",
          inputSchema: z.object({ query: z.string() }),
          execute,
        }),
      },
      toolApproval: () => ({ type: "denied", reason: "Limit reached" }),
      stopWhen: stepCountIs(5),
    });

    let message: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream: result.toUIMessageStream() })) message = m;

    expect(execute).not.toHaveBeenCalled();
    // The loop continues, so the model can explain instead of stopping.
    expect(await result.text).toBe("I've hit the limit for this message.");
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("execution-denied");

    const toolPart = message!.parts.find((p) => p.type === "tool-naturalLanguageJobSearch") as {
      state: string;
      approval?: { isAutomatic?: boolean; approved?: boolean; reason?: string };
    };
    expect(toolPart.state).toBe("output-denied");
    expect(toolPart.approval).toMatchObject({ isAutomatic: true, approved: false, reason: "Limit reached" });
    // useChat must not resend a turn that only had an automatic denial.
    expect(lastAssistantMessageIsCompleteWithApprovalResponses({ messages: [message!] })).toBe(false);
  });

  it("produces a UI message stream response for useChat", async () => {
    const model = mockModel([textStream("ok")]);

    const response = streamText({ model, prompt: "hi" }).toUIMessageStreamResponse();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"type":"text-delta"');
  });
});

describe("one copy of the ai package (RISK-007)", () => {
  // @ai-sdk/otel and @ai-sdk/react pin an exact `ai` version as a regular
  // dependency. If it doesn't match ours, npm installs a second copy, and
  // telemetry (or useChat's stream protocol) silently breaks.
  const require = createRequire(import.meta.url);
  // Resolve from the package's own folder (some are ESM-only, so
  // require.resolve(pkg) itself fails).
  const resolveAiFrom = (pkg: string) =>
    require.resolve("ai", { paths: [join(process.cwd(), "node_modules", pkg)] });

  it.each(["@ai-sdk/otel", "@ai-sdk/react", "@arizeai/openinference-vercel"])(
    "%s uses the app's ai package",
    (pkg) => {
      expect(resolveAiFrom(pkg)).toBe(require.resolve("ai"));
    },
  );
});
