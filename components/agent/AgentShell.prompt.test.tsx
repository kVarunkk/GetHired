import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { savePendingPrompt } from "@/helpers/agent/prompt-draft";
import AgentShell from "./AgentShell";

vi.mock("next/navigation", () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("./MemoriesPanel", () => ({ default: () => null }));
vi.mock("./ChatPane", () => ({
  default: ({ initialDraft }: { initialDraft?: string }) => (
    <div data-testid="chat">draft: {initialDraft}</div>
  ),
}));

const SESSIONS = [{ id: "s1", title: "New chat", updated_at: "now" }];
let replace: ReturnType<typeof vi.fn>;

const renderShell = (initialDraft?: string) =>
  render(
    <AgentShell
      initialSessions={SESSIONS}
      activeSessionId="s1"
      initialMessages={[]}
      initialDraft={initialDraft}
    />,
  );

beforeEach(() => {
  replace = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace, refresh: vi.fn() } as never);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never);
  window.history.replaceState(null, "", "/agent?prompt=remote%20Go%20jobs");
});

afterEach(() => sessionStorage.clear());

describe("AgentShell: starting with a prompt", () => {
  it("passes the prompt to the chat and drops it from the URL", () => {
    const { getByTestId } = renderShell("remote Go jobs");

    expect(getByTestId("chat")).toHaveTextContent("draft: remote Go jobs");
    expect(window.location.pathname + window.location.search).toBe("/agent?session=s1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears a saved prompt that the URL already delivered", () => {
    savePendingPrompt("remote Go jobs");
    renderShell("remote Go jobs");

    expect(sessionStorage.length).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("reopens with a prompt saved before logging in", () => {
    savePendingPrompt("remote Go jobs");
    renderShell();

    expect(replace).toHaveBeenCalledWith("/agent?prompt=remote%20Go%20jobs");
  });

  it("does nothing without a prompt", () => {
    window.history.replaceState(null, "", "/agent");
    renderShell();

    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});
