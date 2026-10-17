"use client";

import { useState } from "react";
import { Check, ListPlus, Loader2, Send } from "lucide-react";
import toast from "react-hot-toast";
import { listTalentListsAction } from "@/app/actions/pipeline/list-talent-lists";
import { saveTalentListAction } from "@/app/actions/pipeline/save-talent-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";

type ListItem = { id: string; name: string; memberCount: number; hasCandidate: boolean };

/**
 * "Add to list" on a candidate (PL-TASK-051): toggles the candidate in the
 * company's talent lists and creates new ones. A talent-pool candidate enters
 * the pipeline by answering an outreach, never through a fake application
 * (PL-REQ-012), so the footer offers "Reach out" (OR-TASK-003).
 *
 * A popover from `sm` up and a bottom drawer below it: on a phone the "New
 * list" field brings up the keyboard, which a bottom sheet copes with and an
 * anchored popover doesn't (see components/ui/responsive-dialog.tsx).
 */
export default function AddToListMenu({
  candidateUserId,
  onReachOut,
  className,
}: {
  candidateUserId: string;
  /** Opens the outreach composer. Without it, the footer isn't shown. */
  onReachOut?: () => void;
  /** For the trigger button. */
  className?: string;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);
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

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && lists === null) void load();
  };

  const trigger = (
    <Button variant="outline" className={className}>
      <ListPlus className="mr-2 h-4 w-4" />
      Add to list
    </Button>
  );

  const panel = (
    <>
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

        {onReachOut && (
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Invite them to apply or chat</span>
            <Button
              size="sm"
              variant="brand"
              onClick={() => {
                setOpen(false);
                onReachOut();
              }}
            >
              <Send className="mr-2 h-3.5 w-3.5" />
              Reach out
            </Button>
          </div>
        )}
    </>
  );

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Add to list</DrawerTitle>
            <DrawerDescription>Save this candidate to your talent lists.</DrawerDescription>
          </DrawerHeader>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 pb-6">{panel}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        {panel}
      </PopoverContent>
    </Popover>
  );
}
