import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentPromptHref,
  COMPANY_AGENT_PATH,
  MAX_PROMPT_CHARS,
  readPromptParam,
  savePendingPrompt,
  takePendingPrompt,
} from "./prompt-draft";

const store = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
});

afterEach(() => {
  store.clear();
  vi.useRealTimers();
});

describe("readPromptParam", () => {
  it("trims, caps and ignores anything that isn't text", () => {
    expect(readPromptParam("  remote Go jobs ")).toBe("remote Go jobs");
    expect(readPromptParam(["first", "second"])).toBe("first");
    expect(readPromptParam("x".repeat(MAX_PROMPT_CHARS + 50))).toHaveLength(MAX_PROMPT_CHARS);
    expect(readPromptParam(undefined)).toBe("");
    expect(readPromptParam(42)).toBe("");
  });
});

describe("agentPromptHref", () => {
  it("encodes the prompt, or links to a plain /agent without one", () => {
    expect(agentPromptHref("React & Go, ₹30L?")).toBe(
      `/agent?prompt=${encodeURIComponent("React & Go, ₹30L?")}`,
    );
    expect(agentPromptHref("   ")).toBe("/agent");
  });

  it("links to the company agent when given its path", () => {
    expect(agentPromptHref("Find Go engineers", COMPANY_AGENT_PATH)).toBe(
      `/company/agent?prompt=${encodeURIComponent("Find Go engineers")}`,
    );
    expect(agentPromptHref("", COMPANY_AGENT_PATH)).toBe("/company/agent");
  });
});

describe("pending prompt", () => {
  it("is returned once, then forgotten", () => {
    savePendingPrompt("remote Go jobs");
    expect(takePendingPrompt()).toBe("remote Go jobs");
    expect(takePendingPrompt()).toBe("");
  });

  it("doesn't save an empty prompt", () => {
    savePendingPrompt("  ");
    expect(store.size).toBe(0);
  });

  it("is ignored after an hour", () => {
    vi.useFakeTimers();
    savePendingPrompt("remote Go jobs");
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(takePendingPrompt()).toBe("");
  });

  it("is ignored when the stored value is malformed", () => {
    store.set("gethired:agent-prompt", "not json");
    expect(takePendingPrompt()).toBe("");
  });
});
