"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Over,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { removeTrackedApplicationAction } from "@/app/actions/tracker/remove-tracked-application";
import { setExternalApplicationStatusAction } from "@/app/actions/applications/set-external-application-status";
import { removeExternalApplicationAction } from "@/app/actions/applications/remove-external-application";
import { filterByKeyword } from "@/helpers/tracker/search";
import {
  BOARD_COLUMNS,
  CLOSED_OUTCOMES,
  boardColumnLabel,
  trackedStatusLabel,
  type AppliedStatus,
  type BoardColumn,
} from "@/helpers/tracker/status";
import type { TrackerItem } from "@/helpers/tracker/types";
import { cn } from "@/utils/utils";
import { boardReducer, columnCards, initialBoardState, isLocked, type SaveRequest } from "./board-machine";
import TrackerCard from "./TrackerCard";

/**
 * Where the pointer is wins, so a card dropped on an empty or tall column lands
 * in that column. Corner distance alone picked the card's own column. Keyboard
 * drags have no pointer, so they fall back to the nearest corners.
 */
const collide: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCorners(args);
};

const columnOfOver =(over: Over | null): BoardColumn | null =>
  over ? ((over.data.current?.column as BoardColumn | undefined) ?? null) : null;

async function sendSave(save: SaveRequest) {
  if (save.legacy) {
    if (!save.allJobsId) return { ok: false as const, error: "Application not found." };
    const result = await setExternalApplicationStatusAction({ allJobsId: save.allJobsId, status: save.status });
    return result.ok ? { ok: true as const, item: undefined } : { ok: false as const, error: result.error };
  }
  const result = await setTrackedStatusAction({ id: save.id, status: save.status, position: save.position });
  return result.ok ? { ok: true as const, item: result.item } : { ok: false as const, error: result.error };
}

/**
 * The Applications board (AT-REQ-014–018): five columns, Closed collapsed.
 * Tracked cards move by drag, by keyboard or from their menu; GetHired
 * cards are the company's to move. Below `md` it's a column picker over
 * one list.
 */
export default function ApplicationsBoard({ items, q }: { items: TrackerItem[]; q?: string | null }) {
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [state, dispatch] = useReducer(boardReducer, items, initialBoardState);
  const [removing, setRemoving] = useState<TrackerItem | null>(null);

  useEffect(() => {
    dispatch({ type: "sync", items });
  }, [items]);

  // Send the queued moves; the reducer rolls back any that fail.
  useEffect(() => {
    if (state.saves.length === 0) return;
    const saves = state.saves;
    dispatch({ type: "saves_sent" });
    for (const save of saves) {
      void sendSave(save).then((result) => {
        if (result.ok) {
          dispatch({ type: "save_ok", id: save.id, item: result.item });
          if (save.legacy) router.refresh();
        } else {
          dispatch({ type: "save_failed", id: save.id, error: result.error });
        }
      });
    }
  }, [state.saves, router]);

  useEffect(() => {
    if (!state.error) return;
    toast.error(state.error);
    dispatch({ type: "error_shown" });
  }, [state.error]);

  const visible = useMemo(() => filterByKeyword(state.items, q), [state.items, q]);
  const cardsIn = (column: BoardColumn) => columnCards(visible, column);
  const move = (id: string, status: AppliedStatus) => dispatch({ type: "move_to", id, status });

  const remove = async () => {
    if (!removing) return;
    const result =
      removing.legacy && removing.allJobsId
        ? await removeExternalApplicationAction({ allJobsId: removing.allJobsId })
        : await removeTrackedApplicationAction(removing.id);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Removed from My Jobs.");
    router.refresh();
  };

  const outcomeItem = state.outcomeMenu ? state.items.find((item) => item.id === state.outcomeMenu?.id) : null;

  return (
    <>
      {isDesktop ? (
        <DesktopBoard
          cardsIn={cardsIn}
          nameOf={(id) => state.items.find((item) => item.id === id)?.jobTitle ?? "Application"}
          onDragStart={(id) => dispatch({ type: "drag_start", id })}
          onDragCancel={() => dispatch({ type: "drag_cancel" })}
          onDrop={(id, column, index) => dispatch({ type: "drop", id, column, index })}
          onMove={move}
          onRemove={setRemoving}
        />
      ) : (
        <MobileBoard cardsIn={cardsIn} onMove={move} onRemove={setRemoving} />
      )}

      <Dialog open={Boolean(state.outcomeMenu)} onOpenChange={(open) => !open && dispatch({ type: "outcome_cancel" })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>How did it end?</DialogTitle>
            <DialogDescription>{outcomeItem ? `${outcomeItem.jobTitle} at ${outcomeItem.companyName}` : null}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {CLOSED_OUTCOMES.map((status) => (
              <Button key={status} variant="outline" onClick={() => dispatch({ type: "outcome_pick", status })}>
                {trackedStatusLabel(status)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this application?"
        description="It's removed from My Jobs, with its notes and timeline. This can't be undone."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </>
  );
}

type ColumnsProps = {
  cardsIn: (column: BoardColumn) => TrackerItem[];
  onMove: (id: string, status: AppliedStatus) => void;
  onRemove: (item: TrackerItem) => void;
};

function DesktopBoard({
  cardsIn,
  nameOf,
  onDragStart,
  onDragCancel,
  onDrop,
  onMove,
  onRemove,
}: ColumnsProps & {
  nameOf: (id: string) => string;
  onDragStart: (id: string) => void;
  onDragCancel: () => void;
  onDrop: (id: string, column: BoardColumn, index: number) => void;
}) {
  const [closedOpen, setClosedOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  // The column the card is over, whether the pointer is on the column itself or on a card in it.
  const [dragging, setDragging] = useState(false);
  const [overColumn, setOverColumn] = useState<BoardColumn | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const stopDragging = () => {
    setDragging(false);
    setOverColumn(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    stopDragging();
    const column = columnOfOver(over);
    const id = String(active.id);
    if (!column || !over) return onDragCancel();
    // Where among the column's movable cards it lands: on a card, in its place; on the column, at the bottom.
    const movable = cardsIn(column).filter((item) => !isLocked(item) && !item.legacy && item.id !== id);
    const overIndex = movable.findIndex((item) => item.id === String(over.id));
    onDrop(id, column, overIndex >= 0 ? overIndex : movable.length);
  };

  return (
    <DndContext
      id="my-jobs-board"
      sensors={sensors}
      collisionDetection={collide}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}.`,
          onDragOver: ({ active, over }) => {
            const column = columnOfOver(over);
            return column ? `${nameOf(String(active.id))} is over ${boardColumnLabel(column)}.` : undefined;
          },
          onDragEnd: ({ active, over }) => {
            const column = columnOfOver(over);
            return column
              ? `${nameOf(String(active.id))} was dropped in ${boardColumnLabel(column)}.`
              : `${nameOf(String(active.id))} was dropped.`;
          },
          onDragCancel: ({ active }) => `Moving ${nameOf(String(active.id))} was cancelled.`,
        },
        screenReaderInstructions: {
          draggable:
            "To move an application, press Space or Enter. Use the arrow keys to choose a column, then press Space or Enter to drop it, or Escape to cancel.",
        },
      }}
      onDragStart={({ active }) => {
        setDragging(true);
        onDragStart(String(active.id));
      }}
      onDragOver={({ over }) => setOverColumn(columnOfOver(over))}
      onDragCancel={() => {
        stopDragging();
        onDragCancel();
      }}
      onDragEnd={onDragEnd}
    >
      <div>
        {/* The headers sit in their own strip that sticks to the top of the page and follows the board's sideways scroll,
            so the page scrolls up and down and the board only sideways. */}
        <div ref={stripRef} className="sticky top-0 z-10 overflow-hidden bg-background">
          <div className="flex w-max gap-3">
            {BOARD_COLUMNS.map((column) => (
              <ColumnHeader
                key={column}
                column={column}
                count={cardsIn(column).length}
                collapsed={column === "closed" && !closedOpen}
                isTarget={overColumn === column}
                onToggle={column === "closed" ? () => setClosedOpen((open) => !open) : undefined}
              />
            ))}
          </div>
        </div>
        <div
          className="flex items-stretch gap-3 overflow-x-auto pb-2"
          onScroll={(event) => {
            if (stripRef.current) stripRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        >
          {BOARD_COLUMNS.map((column) => (
            <Column
              key={column}
              column={column}
              cards={cardsIn(column)}
              collapsed={column === "closed" && !closedOpen}
              dragging={dragging}
              isTarget={overColumn === column}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function Column({
  column,
  cards,
  collapsed,
  dragging,
  isTarget,
  onMove,
  onRemove,
}: {
  column: BoardColumn;
  cards: TrackerItem[];
  collapsed: boolean;
  /** A card is being dragged: every column shows it can take it. */
  dragging: boolean;
  /** The dragged card is over this column (or one of its cards). */
  isTarget: boolean;
  onMove: ColumnsProps["onMove"];
  onRemove: ColumnsProps["onRemove"];
}) {
  const { setNodeRef } = useDroppable({ id: `column:${column}`, data: { column } });
  const label = boardColumnLabel(column);

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        "flex flex-col rounded-b-lg border border-t-0 bg-muted/30 transition-colors",
        collapsed ? "w-36 shrink-0" : "w-72 shrink-0",
        dragging && "border-dashed border-primary/40",
        isTarget && "border-solid border-primary bg-primary/10 ring-2 ring-primary/30",
      )}
    >
      {collapsed ? (
        <p className="min-h-16 flex-1 p-3 text-xs text-muted-foreground">Drop here to close an application.</p>
      ) : (
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-16 flex-1 flex-col gap-2 p-2">
            {cards.map((card) => (
              <SortableCard key={card.id} item={card} column={column} onMove={onMove} onRemove={onRemove} />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function ColumnHeader({
  column,
  count,
  collapsed,
  isTarget,
  onToggle,
}: {
  column: BoardColumn;
  count: number;
  collapsed: boolean;
  isTarget: boolean;
  onToggle?: () => void;
}) {
  const label = boardColumnLabel(column);
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-t-lg border px-3 py-2 text-sm",
        collapsed ? "w-36 shrink-0" : "w-72 shrink-0",
        isTarget ? "border-primary bg-primary/10" : "bg-muted",
      )}
    >
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="inline-flex items-center gap-1 font-semibold">
          {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          {label}
        </button>
      ) : (
        <span className="font-semibold">{label}</span>
      )}
      <span className="text-muted-foreground">{count}</span>
    </div>
  );
}

function SortableCard({
  item,
  column,
  onMove,
  onRemove,
}: {
  item: TrackerItem;
  column: BoardColumn;
  onMove: ColumnsProps["onMove"];
  onRemove: ColumnsProps["onRemove"];
}) {
  const locked = isLocked(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { column },
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80")}
    >
      <TrackerCard
        item={item}
        onMove={(status) => onMove(item.id, status)}
        onRemove={() => onRemove(item)}
        handle={
          locked ? undefined : (
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Move ${item.jobTitle}`}
              className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )
        }
      />
    </div>
  );
}

/** Below `md`: one column at a time, no drag; cards move from their menu (AT-REQ-018). */
export function MobileBoard({ cardsIn, onMove, onRemove }: ColumnsProps) {
  const [column, setColumn] = useState<BoardColumn>("applied");
  const cards = cardsIn(column);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={column} onValueChange={(value) => setColumn(value as BoardColumn)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {BOARD_COLUMNS.map((value) => (
            <TabsTrigger key={value} value={value} className="whitespace-nowrap px-2 text-xs">
              {boardColumnLabel(value)} ({cardsIn(value).length})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-2" aria-label={boardColumnLabel(column)} role="list">
        {cards.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          cards.map((item) => (
            <div role="listitem" key={item.id}>
              <TrackerCard item={item} onMove={(status) => onMove(item.id, status)} onRemove={() => onRemove(item)} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
