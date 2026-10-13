import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { isStopped, stoppedReply } from "./stopped";

const reply = (parts: unknown[], metadata?: unknown): UIMessage =>
  ({ id: "a1", role: "assistant", parts, metadata }) as UIMessage;

const searched = {
  type: "tool-searchJobs",
  toolCallId: "c1",
  state: "output-available",
  input: {},
  output: { jobs: [] },
};

describe("stoppedReply", () => {
  it("keeps the text and finished tool steps and marks the reply stopped", () => {
    const result = stoppedReply(
      reply([
        { type: "step-start" },
        searched,
        { type: "text", text: "Here are the first", state: "streaming" },
      ]),
    );

    expect(result).toEqual(
      reply(
        [
          { type: "step-start" },
          searched,
          { type: "text", text: "Here are the first", state: "done" },
        ],
        { stopped: true },
      ),
    );
  });

  it("drops unfinished tool calls and suggestions", () => {
    const result = stoppedReply(
      reply([
        searched,
        { type: "tool-listSavedJobs", toolCallId: "c2", state: "input-streaming", input: {} },
        { type: "tool-startResumeReview", toolCallId: "c3", state: "approval-responded", input: {}, approval: { id: "ap", approved: true } },
        { type: "data-suggestions", id: "suggestions", data: { suggestions: ["More"] } },
      ]),
    );

    expect(result?.parts).toEqual([searched]);
  });

  it("returns null when nothing is left to show", () => {
    expect(
      stoppedReply(
        reply([
          { type: "step-start" },
          { type: "text", text: "", state: "streaming" },
          { type: "tool-searchJobs", toolCallId: "c1", state: "input-available", input: {} },
        ]),
      ),
    ).toBeNull();
  });

  it("keeps existing metadata", () => {
    expect(stoppedReply(reply([searched], { model: "x" }))?.metadata).toEqual({
      model: "x",
      stopped: true,
    });
  });
});

describe("isStopped", () => {
  it("reads the stopped mark", () => {
    expect(isStopped(reply([], { stopped: true }))).toBe(true);
    expect(isStopped(reply([]))).toBe(false);
    expect(isStopped(reply([], "stopped"))).toBe(false);
  });
});
