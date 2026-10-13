"use client";

import { useState } from "react";
import { Brain, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AGENT_MEMORY_MAX_CHARS } from "@/helpers/agent/config";

type Memory = { id: string; content: string; category: string };

const CATEGORY_HEADINGS: [string, string][] = [
  ["preference", "Preferences"],
  ["goal", "Goals"],
  ["constraint", "Constraints"],
  ["fact", "Facts"],
];

async function errorFrom(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}

/** Placeholder rows shaped like a category heading and its list. */
function MemoriesSkeleton() {
  return (
    <div role="status" aria-label="Loading memories" className="flex flex-col gap-2 animate-pulse">
      <div aria-hidden className="h-3 w-20 rounded bg-muted" />
      <div aria-hidden className="divide-y rounded-lg border">
        {[0.85, 0.6, 0.75].map((width) => (
          <div key={width} className="px-3 py-3.5">
            <div className="h-3.5 rounded bg-muted" style={{ width: `${width * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lets the user review, edit and delete what the agent remembers (REQ-012). */
export default function MemoriesPanel() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/agent/memories");
      if (!response.ok) {
        setError(await errorFrom(response));
        return;
      }
      const body = (await response.json()) as { memories: Memory[] };
      setMemories(body.memories);
    } catch {
      setError("Couldn't load memories. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const save = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/agent/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (!response.ok) {
      setError(await errorFrom(response));
      return;
    }
    const { memory } = (await response.json()) as { memory: Memory };
    setMemories((current) => current?.map((m) => (m.id === id ? memory : m)) ?? null);
    setEditingId(null);
  };

  const remove = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/agent/memories/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await errorFrom(response));
      return;
    }
    setMemories((current) => current?.filter((m) => m.id !== id) ?? null);
  };

  return (
    <Sheet onOpenChange={(open) => open && load()}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Brain className="h-4 w-4" />
          Memories
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>What the assistant remembers</SheetTitle>
          <SheetDescription>
            Facts the assistant saved about you across chats. Your job preferences live on your
            profile.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Only before the first load: a reopen keeps the list while it refreshes. */}
        {loading && memories === null && <MemoriesSkeleton />}

        {memories?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No memories yet. Tell the assistant things like companies to avoid, and it will remember
            them.
          </p>
        )}

        {CATEGORY_HEADINGS.map(([category, heading]) => {
          const group = memories?.filter((m) => m.category === category) ?? [];
          if (group.length === 0) return null;
          return (
            <section key={category} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{heading}</h3>
              <ul className="divide-y rounded-lg border">
                {group.map((memory) => (
                  <li key={memory.id} className="group px-3 py-2.5 text-sm leading-6">
                    {editingId === memory.id ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          aria-label="Memory"
                          value={draft}
                          maxLength={AGENT_MEMORY_MAX_CHARS}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => save(memory.id)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="flex-1">{memory.content}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Edit: ${memory.content}`}
                          onClick={() => {
                            setDraft(memory.content);
                            setEditingId(memory.id);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Delete: ${memory.content}`}
                          onClick={() => remove(memory.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </SheetContent>
    </Sheet>
  );
}
