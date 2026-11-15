import { describe, expect, it } from "vitest";
import { initialSelfSchedule, pendingAction, selfScheduleReducer as reduce, type SelfScheduleState } from "./self-schedule-machine";

const SLOT = { start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T10:30:00.000Z" };
const run = (state: SelfScheduleState, ...events: Parameters<typeof reduce>[1][]) => events.reduce(reduce, state);

describe("self-schedule machine (IVT-063)", () => {
  it("starts on the slot list before booking, and on the booked time after", () => {
    expect(initialSelfSchedule("awaiting_candidate", "UTC").mode).toBe("pick");
    expect(initialSelfSchedule("scheduled", "UTC").mode).toBe("view");
  });

  it("books: pick, submit, done; the booked time is shown", () => {
    let s = run(initialSelfSchedule("awaiting_candidate", "Europe/Paris"), { type: "pick", slot: SLOT });
    expect(pendingAction(s)).toBe("book");
    s = reduce(s, { type: "submit" });
    expect(s.submitting).toBe(true);
    s = reduce(s, { type: "succeeded", done: "booked" });
    expect(s).toMatchObject({ mode: "view", status: "scheduled", done: "booked", slot: null, zone: "Europe/Paris" });
  });

  it("can't submit without a time", () => {
    const s = reduce(initialSelfSchedule("awaiting_candidate", "UTC"), { type: "submit" });
    expect(s.submitting).toBe(false);
    expect(pendingAction(s)).toBeNull();
  });

  it("drops a taken time and says so", () => {
    const s = run(
      initialSelfSchedule("awaiting_candidate", "UTC"),
      { type: "pick", slot: SLOT },
      { type: "submit" },
      { type: "failed", reason: "slot_taken", error: "That time was just taken." },
    );
    expect(s).toMatchObject({ submitting: false, slot: null, error: "That time was just taken.", mode: "pick" });
  });

  it("keeps the pick on other failures, so the candidate can retry", () => {
    const s = run(
      initialSelfSchedule("awaiting_candidate", "UTC"),
      { type: "pick", slot: SLOT },
      { type: "submit" },
      { type: "failed", reason: "calendar_failed", error: "Try again." },
    );
    expect(s.slot).toEqual(SLOT);
  });

  it("reschedules from the booked view, and can go back", () => {
    let s = reduce(initialSelfSchedule("scheduled", "UTC"), { type: "reschedule" });
    expect(s.mode).toBe("pick");
    s = reduce(s, { type: "pick", slot: SLOT });
    expect(pendingAction(s)).toBe("reschedule");
    expect(reduce(s, { type: "back" })).toMatchObject({ mode: "view", slot: null });
    s = run(s, { type: "submit" }, { type: "succeeded", done: "rescheduled" });
    expect(s).toMatchObject({ mode: "view", status: "scheduled", done: "rescheduled" });
  });

  it("asks before cancelling; a cancel opens the slot list again", () => {
    let s = reduce(initialSelfSchedule("scheduled", "UTC"), { type: "ask_cancel" });
    expect(pendingAction(s)).toBe("cancel");
    s = run(s, { type: "submit" }, { type: "succeeded", done: "cancelled" });
    expect(s).toMatchObject({ mode: "pick", status: "awaiting_candidate", done: "cancelled" });
  });

  it("can't reschedule, cancel or go back before booking", () => {
    const s = initialSelfSchedule("awaiting_candidate", "UTC");
    expect(reduce(s, { type: "reschedule" })).toBe(s);
    expect(reduce(s, { type: "ask_cancel" })).toBe(s);
    expect(reduce(s, { type: "back" })).toBe(s);
  });

  it("ignores clicks while submitting, but not a zone change", () => {
    const s = run(initialSelfSchedule("awaiting_candidate", "UTC"), { type: "pick", slot: SLOT }, { type: "submit" });
    expect(reduce(s, { type: "pick", slot: { ...SLOT, start: "x" } })).toBe(s);
    expect(reduce(s, { type: "zone", zone: "Asia/Kolkata" }).zone).toBe("Asia/Kolkata");
  });
});
