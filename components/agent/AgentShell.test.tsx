import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import AgentShell from "./AgentShell";

vi.mock("next/navigation", () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("./MemoriesPanel", () => ({ default: () => <div>memories panel</div> }));
vi.mock("./ChatPane", () => ({
  default: ({
    sessionId,
    initialMessages,
    onFinish,
  }: {
    sessionId: string;
    initialMessages: UIMessage[];
    onFinish: () => void;
  }) => (
    <div data-testid="chat">
      chat {sessionId} with {initialMessages.length} messages
      <button onClick={onFinish}>finish reply</button>
    </div>
  ),
}));

const SESSIONS = [
  { id: "s1", title: "First", updated_at: "2026-10-11T10:00:00.000Z" },
  { id: "s2", title: "Second", updated_at: "2026-10-10T10:00:00.000Z" },
];
const MESSAGES: UIMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];

let push: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  push = vi.fn();
  refresh = vi.fn();
  replace = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push, refresh, replace } as never);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("session=s1") as never);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/agent/sessions" && init?.method === "POST") {
      return json({ session: { id: "s3", title: "New chat", updated_at: "now" } }, 201);
    }
    if (url === "/api/agent/sessions") {
      return json({ sessions: [{ ...SESSIONS[0], title: "Remote React jobs" }, SESSIONS[1]] });
    }
    if (init?.method === "PATCH") {
      return json({ session: { id: "s2", title: "Renamed", updated_at: "now" } });
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AgentShell
      initialSessions={SESSIONS}
      activeSessionId="s1"
      initialMessages={MESSAGES}
      titleRefreshDelayMs={0}
    />,
  );
});

afterEach(() => vi.unstubAllGlobals());

const sidebar = () => screen.getAllByRole("navigation", { name: "Chat sessions" })[0];

describe("AgentShell", () => {
  it("renders the active session's chat", () => {
    expect(screen.getByTestId("chat")).toHaveTextContent("chat s1 with 1 messages");
    expect(screen.getByText("memories panel")).toBeInTheDocument();
  });

  it("collapses and expands the desktop sidebar", async () => {
    const hide = screen.getByRole("button", { name: "Hide chats" });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    const panel = document.getElementById("agent-sessions")!;
    await userEvent.click(hide);
    // Stays mounted so the width can animate, but is hidden and unfocusable.
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveClass("w-0");
    expect(screen.queryByRole("navigation", { name: "Chat sessions" })).not.toBeInTheDocument();

    const show = screen.getByRole("button", { name: "Show chats" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(show);
    expect(panel).not.toHaveAttribute("inert");
    expect(panel).toHaveClass("w-64");
    expect(sidebar()).toBeInTheDocument();
  });

  it("switches sessions through the URL", async () => {
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Second" }));

    expect(push).toHaveBeenCalledWith("/agent?session=s2");
  });

  it("creates a session and opens it", async () => {
    await userEvent.click(within(sidebar()).getByRole("button", { name: "New chat" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions", { method: "POST" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/agent?session=s3"));
  });

  it("renames a session", async () => {
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Rename Second" }));
    const input = screen.getByRole("textbox", { name: "Session title" });
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/s2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(await within(sidebar()).findByRole("button", { name: "Renamed" })).toBeInTheDocument();
  });

  it("removes a deleted session without navigating", async () => {
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Delete Second" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/s2", { method: "DELETE" });
    await waitFor(() =>
      expect(within(sidebar()).queryByRole("button", { name: "Second" })).not.toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves a deleted active session", async () => {
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Delete First" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/agent"));
  });

  it("refreshes the session list after a reply, to pick up the generated title", async () => {
    await userEvent.click(screen.getByRole("button", { name: "finish reply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions"));
    expect(
      await within(sidebar()).findByRole("button", { name: "Remote React jobs" }),
    ).toBeInTheDocument();
  });

  it("refreshes the route after a reply, so coming back shows the new turn", async () => {
    await userEvent.click(screen.getByRole("button", { name: "finish reply" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("AgentShell: a reply in a chat opened with a prompt", () => {
  it("goes to the session's URL instead of refreshing ?prompt=, which would open another chat", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("prompt=remote%20Go%20jobs") as never,
    );
    render(<AgentShell initialSessions={SESSIONS} activeSessionId="s2" initialMessages={[]} />);

    await userEvent.click(screen.getAllByRole("button", { name: "finish reply" }).at(-1)!);

    expect(replace).toHaveBeenCalledWith("/agent?session=s2", { scroll: false });
    expect(refresh).not.toHaveBeenCalled();
  });
});
