import { describe, expect, it } from "vitest";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import { boardReducer, columnCards, initialBoardState, positionAt, type BoardEvent, type BoardState } from "./board-machine";

const run = (state: BoardState, ...events: BoardEvent[]) => events.reduce(boardReducer, state);

describe("positionAt", () => {
  it("takes the midpoint, min - 1 at the top and max + 1 at the bottom", () => {
    expect(positionAt([10, 20, 30], 1, 0)).toBe(15);
    expect(positionAt([10, 20, 30], 0, 0)).toBe(9);
    expect(positionAt([10, 20, 30], undefined, 0)).toBe(9);
    expect(positionAt([10, 20, 30], 3, 0)).toBe(31);
    expect(positionAt([10, 20, 30], 99, 0)).toBe(31);
    expect(positionAt([], 0, 42)).toBe(42);
  });
});

describe("columnCards", () => {
  it("puts tracked cards by position, then GetHired and legacy cards newest first", () => {
    const a = trackerItem({ position: 5 });
    const b = trackerItem({ position: 1 });
    const old = gethiredItem({ appliedAt: "2026-10-01" });
    const recent = gethiredItem({ appliedAt: "2026-11-01" });
    const legacy = trackerItem({ legacy: true, appliedAt: "2026-10-15", position: 0 });
    expect(columnCards([a, old, b, recent, legacy], "applied").map((item) => item.id)).toEqual([
      b.id,
      a.id,
      recent.id,
      legacy.id,
      old.id,
    ]);
  });
});

describe("boardReducer (AT-TEST-005)", () => {
  const a = trackerItem({ position: 10 });
  const b = trackerItem({ position: 20 });
  const review = trackerItem({ status: "in_review", column: "in_review", statusLabel: "In review", position: 100 });
  const locked = gethiredItem();
  const start = () => initialBoardState([a, b, review, locked]);
  const find = (state: BoardState, id: string) => state.items.find((item) => item.id === id);

  it("drag_start marks the card, and ignores a locked one", () => {
    expect(run(start(), { type: "drag_start", id: a.id }).dragging).toBe(a.id);
    expect(run(start(), { type: "drag_start", id: locked.id }).dragging).toBeNull();
    expect(run(start(), { type: "drag_start", id: a.id }, { type: "drag_cancel" }).dragging).toBeNull();
  });

  it("a drop on another column takes its first status, optimistically, and queues the save", () => {
    const state = run(start(), { type: "drag_start", id: a.id }, { type: "drop", id: a.id, column: "interviewing" });

    expect(find(state, a.id)).toMatchObject({ status: "interviewing", column: "interviewing", statusLabel: "Interviewing" });
    expect(state.saves).toEqual([{ id: a.id, status: "interviewing", position: 10, legacy: false, allJobsId: null }]);
    expect(state.previous[a.id]).toEqual(a);
    expect(state.dragging).toBeNull();
  });

  it("a drop between two cards writes their midpoint, and at the bottom max + 1", () => {
    const o1 = trackerItem({ status: "offer", column: "offer", position: 1 });
    const o3 = trackerItem({ status: "offer", column: "offer", position: 3 });
    const between = run(initialBoardState([a, o1, o3]), { type: "drop", id: a.id, column: "offer", index: 1 });
    expect(between.saves[0]).toMatchObject({ status: "offer", position: 2 });
    const bottom = run(start(), { type: "drop", id: a.id, column: "in_review", index: 1 });
    expect(bottom.saves[0]).toMatchObject({ status: "in_review", position: 101 });
  });

  it("a drop on Closed opens the outcome menu and changes nothing until picked", () => {
    const state = run(start(), { type: "drop", id: a.id, column: "closed" });
    expect(state.outcomeMenu).toEqual({ id: a.id, position: 10 });
    expect(state.items).toEqual(start().items);
    expect(state.saves).toEqual([]);

    const picked = run(state, { type: "outcome_pick", status: "ghosted" });
    expect(find(picked, a.id)).toMatchObject({ status: "ghosted", column: "closed", statusLabel: "Ghosted" });
    expect(picked.saves).toEqual([{ id: a.id, status: "ghosted", position: 10, legacy: false, allJobsId: null }]);
    expect(picked.outcomeMenu).toBeNull();
  });

  it("outcome_cancel leaves the card where it was", () => {
    const state = run(start(), { type: "drop", id: a.id, column: "closed" }, { type: "outcome_cancel" });
    expect(state.outcomeMenu).toBeNull();
    expect(state.items).toEqual(start().items);
    expect(state.saves).toEqual([]);
  });

  it("a reorder in the same column writes only the position", () => {
    const state = run(start(), { type: "drop", id: b.id, column: "applied", index: 0 });
    expect(find(state, b.id)).toMatchObject({ status: "applied", position: 9 });
    expect(state.saves).toEqual([{ id: b.id, status: "applied", position: 9, legacy: false, allJobsId: null }]);
  });

  it("a drop where the card already is saves nothing", () => {
    expect(run(initialBoardState([a]), { type: "drop", id: a.id, column: "applied" }).saves).toEqual([]);
  });

  it("save_failed puts the card back and reports the error", () => {
    const state = run(
      start(),
      { type: "drop", id: a.id, column: "offer" },
      { type: "saves_sent" },
      { type: "save_failed", id: a.id, error: "Something went wrong." },
    );
    expect(find(state, a.id)).toEqual(a);
    expect(state.previous).toEqual({});
    expect(state.error).toBe("Something went wrong.");
    expect(run(state, { type: "error_shown" }).error).toBeNull();
  });

  it("two quick moves then a failure go back to where it started", () => {
    const state = run(
      start(),
      { type: "drop", id: a.id, column: "in_review" },
      { type: "drop", id: a.id, column: "offer" },
      { type: "save_failed", id: a.id, error: "x" },
    );
    expect(find(state, a.id)).toEqual(a);
  });

  it("save_ok keeps the move and takes the server's card", () => {
    const fromServer = { ...a, status: "offer" as const, column: "offer" as const, statusLabel: "Offer", statusChangedAt: "2026-11-24T00:00:00Z" };
    const state = run(
      start(),
      { type: "drop", id: a.id, column: "offer" },
      { type: "saves_sent" },
      { type: "save_ok", id: a.id, item: fromServer },
    );
    expect(find(state, a.id)).toEqual(fromServer);
    expect(state.previous).toEqual({});
    expect(state.saves).toEqual([]);
  });

  it("locked cards don't move by drop or menu", () => {
    for (const event of [
      { type: "drop", id: locked.id, column: "offer" },
      { type: "move_to", id: locked.id, status: "offer" },
    ] as BoardEvent[]) {
      const state = run(start(), event);
      expect(find(state, locked.id)).toEqual(locked);
      expect(state.saves).toEqual([]);
    }
  });

  it("move_to (the menu, mobile) puts the card at the top of the new column", () => {
    const inReview = run(start(), { type: "move_to", id: a.id, status: "in_review" });
    expect(inReview.saves[0]).toMatchObject({ status: "in_review", position: 99 });
    const closed = run(start(), { type: "move_to", id: a.id, status: "accepted" });
    expect(find(closed, a.id)).toMatchObject({ status: "accepted", column: "closed" });
  });

  it("a legacy card moves between columns without a position", () => {
    const legacy = trackerItem({ legacy: true, allJobsId: "j1" });
    const state = run(initialBoardState([legacy]), { type: "drop", id: legacy.id, column: "offer" });
    expect(state.saves).toEqual([{ id: legacy.id, status: "offer", position: undefined, legacy: true, allJobsId: "j1" }]);
  });

  it("sync takes the server's cards but keeps one that's still saving", () => {
    const moving = run(start(), { type: "drop", id: a.id, column: "offer" });
    const synced = run(moving, { type: "sync", items: [a, { ...b, jobTitle: "Renamed" }] });
    expect(find(synced, a.id)?.column).toBe("offer");
    expect(find(synced, b.id)?.jobTitle).toBe("Renamed");
    expect(synced.items).toHaveLength(2);
  });
});
