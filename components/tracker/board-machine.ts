// Pure. The Applications board's state (AT-REQ-015, AT-TEST-005): drags,
// the Closed outcome menu, optimistic moves and their rollback. The component
// sends what's in `saves` and answers with save_ok / save_failed.

import { columnOf, firstStatusOf, trackedStatusLabel, type AppliedStatus, type BoardColumn, type ClosedOutcome } from "@/helpers/tracker/status";
import type { TrackerItem } from "@/helpers/tracker/types";

export type SaveRequest = {
  id: string;
  status: AppliedStatus;
  /** Only for tracked cards: legacy cards have no stored order. */
  position?: number;
  legacy: boolean;
  allJobsId: string | null;
};

export type BoardState = {
  items: TrackerItem[];
  dragging: string | null;
  /** A card dropped on Closed, waiting for its outcome. Nothing has changed yet. */
  outcomeMenu: { id: string; position: number | undefined } | null;
  /** The card as it was before each unsaved move, to put it back on failure. */
  previous: Record<string, TrackerItem>;
  /** Moves to send. The component takes them with `saves_sent`. */
  saves: SaveRequest[];
  /** The latest failure, for a toast. */
  error: string | null;
};

export type BoardEvent =
  | { type: "sync"; items: TrackerItem[] }
  | { type: "drag_start"; id: string }
  | { type: "drag_cancel" }
  /** `index`: where among the column's movable cards it lands (without the dragged one); omitted = top. */
  | { type: "drop"; id: string; column: BoardColumn; index?: number }
  | { type: "move_to"; id: string; status: AppliedStatus }
  | { type: "outcome_pick"; status: ClosedOutcome }
  | { type: "outcome_cancel" }
  | { type: "saves_sent" }
  | { type: "save_ok"; id: string; item?: TrackerItem }
  | { type: "save_failed"; id: string; error: string }
  | { type: "error_shown" };

export const initialBoardState = (items: TrackerItem[]): BoardState => ({
  items,
  dragging: null,
  outcomeMenu: null,
  previous: {},
  saves: [],
  error: null,
});

/** GetHired cards are the company's to move (AT-REQ-016). */
export const isLocked = (item: TrackerItem) => item.kind === "gethired";

/** Cards that keep an order in a column: tracked ones, not legacy rows. */
const isOrdered = (item: TrackerItem) => item.kind === "tracked" && !item.legacy;

/**
 * A column's cards in board order: tracked cards by position (top = lowest),
 * then legacy and GetHired cards, newest applied first.
 */
export function columnCards(items: TrackerItem[], column: BoardColumn): TrackerItem[] {
  const inColumn = items.filter((item) => item.column === column);
  const ordered = inColumn.filter(isOrdered).sort((a, b) => a.position - b.position);
  const rest = inColumn
    .filter((item) => !isOrdered(item))
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.updatedAt.localeCompare(a.updatedAt));
  return [...ordered, ...rest];
}

/**
 * The position for a card landing at `index` among `others` (sorted): the
 * midpoint of its neighbours, min - 1 at the top, max + 1 at the bottom.
 */
export function positionAt(others: number[], index: number | undefined, fallback: number): number {
  if (others.length === 0) return fallback;
  const at = Math.max(0, Math.min(index ?? 0, others.length));
  if (at === 0) return others[0] - 1;
  if (at === others.length) return others[others.length - 1] + 1;
  return (others[at - 1] + others[at]) / 2;
}

const orderedPositions = (items: TrackerItem[], column: BoardColumn, exceptId: string) =>
  columnCards(items, column)
    .filter((item) => isOrdered(item) && item.id !== exceptId)
    .map((item) => item.position);

/** Moves a card optimistically and queues its save. */
function apply(state: BoardState, id: string, status: AppliedStatus, position: number | undefined): BoardState {
  const item = state.items.find((card) => card.id === id);
  if (!item || isLocked(item)) return state;
  const column = columnOf(status) ?? item.column;
  const statusChanged = item.status !== status;
  const keepsOrder = isOrdered(item) && position !== undefined;
  if (!statusChanged && (!keepsOrder || position === item.position)) return { ...state, dragging: null, outcomeMenu: null };

  const moved: TrackerItem = {
    ...item,
    status,
    statusLabel: trackedStatusLabel(status),
    column,
    ...(keepsOrder ? { position } : {}),
  };
  return {
    ...state,
    dragging: null,
    outcomeMenu: null,
    items: state.items.map((card) => (card.id === id ? moved : card)),
    // Keep the first snapshot: two quick moves roll back to where it started.
    previous: { ...state.previous, [id]: state.previous[id] ?? item },
    saves: [
      ...state.saves.filter((save) => save.id !== id),
      { id, status, position: keepsOrder ? position : undefined, legacy: item.legacy, allJobsId: item.allJobsId },
    ],
  };
}

export function boardReducer(state: BoardState, event: BoardEvent): BoardState {
  switch (event.type) {
    case "sync": {
      // Server data wins, except for cards still being saved.
      const live = new Map(state.items.map((item) => [item.id, item]));
      const items = event.items.map((item) => (state.previous[item.id] ? (live.get(item.id) ?? item) : item));
      return { ...state, items };
    }

    case "drag_start": {
      const item = state.items.find((card) => card.id === event.id);
      if (!item || isLocked(item)) return state;
      return { ...state, dragging: event.id };
    }

    case "drag_cancel":
      return { ...state, dragging: null };

    case "drop": {
      const item = state.items.find((card) => card.id === event.id);
      if (!item || isLocked(item)) return { ...state, dragging: null };
      const position = isOrdered(item)
        ? positionAt(orderedPositions(state.items, event.column, item.id), event.index, item.position)
        : undefined;

      if (event.column === item.column) {
        return item.status ? apply(state, item.id, item.status as AppliedStatus, position) : { ...state, dragging: null };
      }
      const status = firstStatusOf(event.column);
      // Closed asks which outcome first (AT-REQ-015).
      if (!status) return { ...state, dragging: null, outcomeMenu: { id: item.id, position } };
      return apply(state, item.id, status, position);
    }

    case "move_to": {
      const item = state.items.find((card) => card.id === event.id);
      if (!item || isLocked(item)) return state;
      const column = columnOf(event.status) ?? item.column;
      const position =
        isOrdered(item) && column !== item.column ? positionAt(orderedPositions(state.items, column, item.id), 0, item.position) : undefined;
      return apply(state, item.id, event.status, position);
    }

    case "outcome_pick": {
      if (!state.outcomeMenu) return state;
      return apply(state, state.outcomeMenu.id, event.status, state.outcomeMenu.position);
    }

    case "outcome_cancel":
      return { ...state, outcomeMenu: null };

    case "saves_sent":
      return { ...state, saves: [] };

    case "save_ok": {
      const { [event.id]: _done, ...previous } = state.previous;
      void _done;
      const items = event.item
        ? state.items.map((card) => (card.id === event.id ? (event.item as TrackerItem) : card))
        : state.items;
      return { ...state, previous, items };
    }

    case "save_failed": {
      const before = state.previous[event.id];
      const { [event.id]: _failed, ...previous } = state.previous;
      void _failed;
      return {
        ...state,
        previous,
        items: before ? state.items.map((card) => (card.id === event.id ? before : card)) : state.items,
        error: event.error,
      };
    }

    case "error_shown":
      return { ...state, error: null };
  }
}
