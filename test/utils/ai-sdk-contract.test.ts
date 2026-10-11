/**
 * Pins the AI SDK APIs the /agent feature depends on (spec DEP-001, RISK-002),
 * using the test helpers from ./ai. If an SDK upgrade renames or reshapes
 * any of these, this file fails first.
 */
import { describe, expect, it, vi } from "vitest";
import { stepCountIs, streamText, tool } from "ai";
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

  it("emits a tool-approval-request and does not execute tools with needsApproval", async () => {
    const execute = vi.fn(async () => ({ reviewId: "r1" }));
    const model = mockModel([toolCallStream("startResumeReview", { resumeId: "res-1" })]);

    const result = streamText({
      model,
      prompt: "review my resume",
      tools: {
        startResumeReview: tool({
          description: "Start a resume review (costs credits)",
          inputSchema: z.object({ resumeId: z.string() }),
          needsApproval: true,
          execute,
        }),
      },
      stopWhen: stepCountIs(5),
    });

    const partTypes: string[] = [];
    for await (const part of result.fullStream) partTypes.push(part.type);

    expect(partTypes).toContain("tool-approval-request");
    expect(execute).not.toHaveBeenCalled();
  });

  it("produces a UI message stream response for useChat", async () => {
    const model = mockModel([textStream("ok")]);

    const response = streamText({ model, prompt: "hi" }).toUIMessageStreamResponse();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"type":"text-delta"');
  });
});
