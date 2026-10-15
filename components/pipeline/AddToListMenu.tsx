"use client";

import { useState } from "react";
import { Check, ListPlus, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { listTalentListsAction } from "@/app/actions/pipeline/list-talent-lists";
import { saveTalentListAction } from "@/app/actions/pipeline/save-talent-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/utils";

type ListItem = { id: string; name: string; memberCount: number; hasCandidate: boolean };

/**
 * "Add to list" on a candidate (PL-TASK-051): toggles the candidate in the
 * company's talent lists and creates new ones. "Add to pipeline" waits for the
 * outreach spec, because it must never create a fake application (PL-REQ-012).
 */
export default function AddToListMenu({ candidateUserId }: { candidateUserId: string }) {
  const [lists, setLists] = useState<ListItem[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const result = await listTalentListsAction({ candidateUserId });
    if (result.ok) setLists(result.lists);
    else toast.error(result.error);
  };

  const toggle = async (list: ListItem) => {
    setBusy(list.id);
    try {
      const result = await saveTalentListAction({
        op: list.hasCandidate ? "remove" : "add",
        listId: list.id,
        candidateUserId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLists((current) =>
        current?.map((l) =>
          l.id === list.id
            ? { ...l, hasCandidate: !l.hasCandidate, memberCount: l.memberCount + (l.hasCandidate ? -1 : 1) }
            : l,
        ) ?? null,
      );
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("new");
    try {
      const result = await saveTalentListAction({ op: "create", name: newName.trim(), candidateUserId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.list) {
        const { id, name } = result.list;
        setLists((current) => [...(current ?? []), { id, name, memberCount: 1, hasCandidate: true }]);
      }
      setNewName("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover onOpenChange={(open) => open && lists === null && void load()}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <ListPlus className="mr-2 h-4 w-4" />
          Add to list
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        {lists === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading lists" />
        ) : (
          <div className="flex flex-col gap-1">
            {lists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet.</p>}
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                aria-pressed={list.hasCandidate}
                disabled={busy !== null}
                onClick={() => void toggle(list)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60"
              >
                <Check className={cn("h-4 w-4", list.hasCandidate ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{list.name}</span>
                <span className="text-xs text-muted-foreground">{list.memberCount}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-t pt-3">
          <Input
            aria-label="New list name"
            placeholder="New list"
            value={newName}
            maxLength={60}
            className="h-8"
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button size="sm" disabled={!newName.trim() || busy !== null} onClick={() => void create()}>
            Create
          </Button>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button size="sm" variant="ghost" disabled>
            Add to pipeline
          </Button>
          <span className="text-xs text-muted-foreground">Coming with outreach</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
