"use client";

import { useState } from "react";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import SidebarLabel from "@/components/SidebarLabel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/utils/utils";

/** Row actions stay visible on touch screens; on desktop they appear on hover or focus. */
const ACTION_CLASS =
  "h-7 w-7 shrink-0 text-muted-foreground transition-opacity hover:text-foreground md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100";

export type AgentSessionSummary = {
  id: string;
  title: string;
  updated_at: string;
};

const MAX_TITLE_LENGTH = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Splits sessions (newest first) into recency groups, skipping empty ones. */
function groupByRecency(sessions: AgentSessionSummary[], now = new Date()) {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const groups: { heading: string; sessions: AgentSessionSummary[] }[] = [
    { heading: "Today", sessions: [] },
    { heading: "Yesterday", sessions: [] },
    { heading: "Previous 7 days", sessions: [] },
    { heading: "Older", sessions: [] },
  ];
  for (const session of sessions) {
    const updated = new Date(session.updated_at).getTime();
    const index =
      updated >= startOfToday
        ? 0
        : updated >= startOfToday - DAY_MS
          ? 1
          : updated >= startOfToday - 7 * DAY_MS
            ? 2
            : 3;
    groups[index].sessions.push(session);
  }
  return groups.filter((group) => group.sessions.length > 0);
}

export default function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  creating = false,
  open = true,
  onToggle,
}: {
  sessions: AgentSessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  creating?: boolean;
  /** Desktop only: collapsed, the sidebar is a rail with "New chat" and the toggle. */
  open?: boolean;
  /** Shows the Collapse toggle at the bottom, as in the other secondary sidebars. */
  onToggle?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] =
    useState<AgentSessionSummary | null>(null);

  const saveTitle = (id: string) => {
    const title = draft.trim();
    if (!title) return;
    onRename(id, title);
    setEditingId(null);
  };

  // Its own provider: the sidebar also renders outside the app shell (in tests).
  return (
    <TooltipProvider>
      <nav
        aria-label="Chat sessions"
        className="flex h-full flex-col gap-2 overflow-hidden bg-muted/30 p-3"
      >
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={onCreate}
              disabled={creating}
              aria-label="New chat"
              // px-3 centres the icon in the collapsed rail, so it never moves.
              className="w-full shrink-0 justify-start gap-2 overflow-hidden bg-background px-3"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <SidebarLabel open={open}>New chat</SidebarLabel>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={open}>
            <p>New chat</p>
          </TooltipContent>
        </Tooltip>

        {/* Kept mounted and at full width while collapsed, so titles don't reflow as the width animates. */}
        <div
          aria-hidden={!open}
          inert={!open}
          className={cn(
            "-mx-1 flex min-h-0 w-[15.5rem] flex-1 flex-col gap-5 overflow-y-auto px-1 pt-2 transition-opacity duration-300 ease-in-out",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          {groupByRecency(sessions).map((group) => (
            <section key={group.heading} className="flex flex-col gap-0.5">
              <h3
                className="px-2 pb-1 text-xs font-medium text-muted-foreground"
                suppressHydrationWarning
              >
                {group.heading}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.sessions.map((session) => (
                  <li
                    key={session.id}
                    className={cn(
                      "group flex items-center gap-0.5 rounded-md pr-1 transition-colors hover:bg-muted/70",
                      session.id === activeId && "bg-muted",
                    )}
                  >
                    {editingId === session.id ? (
                      <Input
                        aria-label="Session title"
                        autoFocus
                        value={draft}
                        maxLength={MAX_TITLE_LENGTH}
                        className="h-8"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveTitle(session.id);
                          if (event.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-current={
                            session.id === activeId ? "page" : undefined
                          }
                          onClick={() => onSelect(session.id)}
                          className={cn(
                            "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            session.id === activeId &&
                              "font-medium text-foreground",
                          )}
                        >
                          {session.title}
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={`Rename ${session.title}`}
                          onClick={() => {
                            setDraft(session.title);
                            setEditingId(session.id);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="destructive-ghost"
                          className={cn(
                            ACTION_CLASS,
                            "text-destructive hover:text-destructive",
                          )}
                          aria-label={`Delete ${session.title}`}
                          onClick={() => setPendingDelete(session)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {onToggle && (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={open ? "Hide chats" : "Show chats"}
                aria-controls="agent-sessions"
                aria-expanded={open}
                onClick={onToggle}
                className="flex shrink-0 items-center gap-2 overflow-hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                {/* One chevron that turns, as in EntityNav and the main sidebar. */}
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-300",
                    open && "rotate-180",
                  )}
                />
                <SidebarLabel open={open}>Collapse</SidebarLabel>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" hidden={open}>
              <p>Expand</p>
            </TooltipContent>
          </Tooltip>
        )}

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{pendingDelete?.title}&rdquo; and its messages will be
                deleted. Saved memories are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => {
                  if (pendingDelete) onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </nav>
    </TooltipProvider>
  );
}
