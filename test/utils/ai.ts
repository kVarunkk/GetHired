import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type {
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

// `@ai-sdk/google@4` returns v4 models, so tests mock with MockLanguageModelV4.

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const finish = (
  unified: "stop" | "tool-calls",
): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified, raw: undefined },
  usage,
});

const toStream = (chunks: LanguageModelV4StreamPart[]): LanguageModelV4StreamResult => ({
  stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
});

/** One model step that streams `text` and stops. */
export function textStream(text: string): LanguageModelV4StreamResult {
  return toStream([
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    finish("stop"),
  ]);
}

/** One model step that calls `toolName` with `input`. */
export function toolCallStream(
  toolName: string,
  input: unknown,
  toolCallId = "call-1",
): LanguageModelV4StreamResult {
  return toStream([
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    finish("tool-calls"),
  ]);
}

/** A mocked v4 model whose `doGenerate` (generateText) returns `text`. */
export function mockGenerateModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
  });
}

/**
 * A mocked v4 language model. Each entry in `steps` answers one `doStream`
 * call, in order, so a multi-step tool loop can be scripted.
 */
export function mockModel(steps: LanguageModelV4StreamResult[]) {
  return new MockLanguageModelV4({ doStream: steps });
}
