"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { PanelLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { agentPromptHref, takePendingPrompt } from "@/helpers/agent/prompt-draft";
import { cn } from "@/utils/utils";
import ChatPane from "./ChatPane";
import MemoriesPanel from "./MemoriesPanel";
import SessionSidebar, { type AgentSessionSummary } from "./SessionSidebar";

/** Session titles are generated after the reply; wait before refreshing. */
const TITLE_REFRESH_DELAY_MS = 2500;

export default function AgentShell({
  initialSessions,
  activeSessionId,
  initialMessages,
  initialDraft = "",
  messagesUsedToday = 0,
  titleRefreshDelayMs = TITLE_REFRESH_DELAY_MS,
}: {
  initialSessions: AgentSessionSummary[];
  activeSessionId: string;
  initialMessages: UIMessage[];
  /** Text to start the message box with (from `?prompt=`). */
  initialDraft?: string;
  /** The user's messages so far today, toward the daily cap. */
  messagesUsedToday?: number;
  titleRefreshDelayMs?: number;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [creating, setCreating] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // A prompt from the URL is now in the message box: drop it from the URL so a
  // reload doesn't open another chat. With none, a prompt saved before logging
  // in (helpers/agent/prompt-draft.ts) reopens the page with it.
  useEffect(() => {
    const pending = takePendingPrompt();
    if (initialDraft) {
      window.history.replaceState(null, "", `/agent?session=${activeSessionId}`);
    } else if (pending) {
      router.replace(agentPromptHref(pending));
    }
    // Only on arrival, not when switching chats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSession = (id: string) => {
    setMobileOpen(false);
    router.push(`/agent?session=${id}`);
  };

  const refreshSessions = async () => {
    const response = await fetch("/api/agent/sessions");
    if (response.ok) {
      const body = (await response.json()) as { sessions: AgentSessionSummary[] };
      setSessions(body.sessions);
    }
  };

  const createSession = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/agent/sessions", { method: "POST" });
      if (!response.ok) throw new Error();
      const { session } = (await response.json()) as { session: AgentSessionSummary };
      setSessions((current) => [session, ...current]);
      openSession(session.id);
    } catch {
      toast.error("Couldn't start a new chat. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const renameSession = async (id: string, title: string) => {
    const response = await fetch(`/api/agent/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      toast.error("Couldn't rename the chat.");
      return;
    }
    const { session } = (await response.json()) as { session: AgentSessionSummary };
    setSessions((current) => current.map((s) => (s.id === id ? { ...s, ...session } : s)));
  };

  const deleteSession = async (id: string) => {
    const response = await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Couldn't delete the chat.");
      return;
    }
    setSessions((current) => current.filter((s) => s.id !== id));
    if (id === activeSessionId) router.push("/agent");
  };

  const sidebar = (
    <SessionSidebar
      sessions={sessions}
      activeId={activeSessionId}
      onSelect={openSession}
      onCreate={createSession}
      onRename={renameSession}
      onDelete={deleteSession}
      creating={creating}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full md:h-dvh">
      {/* Kept mounted so the width can animate; the inner box keeps a fixed width so items don't reflow mid-animation. */}
      <aside
        id="agent-sessions"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
        className={cn(
          "hidden shrink-0 overflow-hidden transition-[width,border-color] duration-300 ease-in-out md:block",
          sidebarOpen ? "w-64 border-r" : "w-0 border-r border-transparent",
        )}
      >
        <div
          className={cn(
            "h-full w-64 transition-opacity duration-300 ease-in-out",
            sidebarOpen ? "opacity-100" : "opacity-0",
          )}
        >
          {sidebar}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 sm:px-3">
          <div className="flex min-w-0 items-center gap-1">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" className="md:hidden" aria-label="Open chats">
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
                {/* A header row for the sheet's built-in close button (top-4 right-4), so it doesn't cover "New chat". */}
                <div className="flex h-12 shrink-0 items-center border-b px-4 pr-12">
                  <SheetTitle className="text-sm font-medium">Chats</SheetTitle>
                </div>
                <div className="min-h-0 flex-1">{sidebar}</div>
              </SheetContent>
            </Sheet>
            <Button
              size="icon"
              variant="ghost"
              className="hidden md:inline-flex"
              aria-label={sidebarOpen ? "Hide chats" : "Show chats"}
              aria-controls="agent-sessions"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
            <h1 className="truncate px-1 text-sm font-medium">
              {sessions.find((s) => s.id === activeSessionId)?.title ?? "Agent"}
            </h1>
          </div>
          <MemoriesPanel />
        </header>

        <ChatPane
          key={activeSessionId}
          sessionId={activeSessionId}
          initialMessages={initialMessages}
          initialDraft={initialDraft}
          messagesUsedToday={messagesUsedToday}
          onFinish={() => {
            // The reply is saved before the stream closes. Drop the client
            // Router Cache so coming back to this page loads the new turn
            // instead of the payload from when the page was first opened.
            router.refresh();
            setTimeout(refreshSessions, titleRefreshDelayMs);
          }}
        />
      </div>
    </div>
  );
}
