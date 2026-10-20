import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, useSearchParams } from "next/navigation";
import AgentShell from "./AgentShell";
import { savePendingPrompt } from "@/helpers/agent/prompt-draft";

vi.mock("next/navigation", () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("./MemoriesPanel", () => ({ default: () => <div>memories panel</div> }));
vi.mock("./ChatPane", () => ({
  default: ({ onFinish }: { onFinish: () => void }) => <button onClick={onFinish}>finish reply</button>,
}));

const SESSIONS = [
  { id: "s1", title: "First", updated_at: "2026-10-11T10:00:00.000Z" },
  { id: "s2", title: "Second", updated_at: "2026-10-10T10:00:00.000Z" },
];

let push: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  replace = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push, replace, refresh: vi.fn() } as never);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("") as never);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ sessions: SESSIONS })))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const renderShell = (initialDraft = "") =>
  render(
    <AgentShell
      role="company"
      initialSessions={SESSIONS}
      activeSessionId="s1"
      initialMessages={[]}
      initialDraft={initialDraft}
      titleRefreshDelayMs={0}
    />,
  );

describe("AgentShell for a company user: /company/agent", () => {
  it("opens sessions under /company/agent", async () => {
    renderShell();

    await userEvent.click(screen.getAllByRole("button", { name: "Second" })[0]);

    expect(push).toHaveBeenCalledWith("/company/agent?session=s2");
  });

  it("moves to the session's /company/agent URL after the first reply", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "finish reply" }));

    expect(replace).toHaveBeenCalledWith("/company/agent?session=s1", { scroll: false });
  });

  it("reopens a prompt saved before login under /company/agent", () => {
    savePendingPrompt("Find Go engineers");
    renderShell();

    expect(replace).toHaveBeenCalledWith(`/company/agent?prompt=${encodeURIComponent("Find Go engineers")}`);
  });

  it("drops ?prompt= from the /company/agent URL once it's in the message box", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    renderShell("Find Go engineers");

    expect(spy).toHaveBeenCalledWith(null, "", "/company/agent?session=s1");
  });
});
