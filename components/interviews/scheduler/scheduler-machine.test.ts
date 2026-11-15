import { describe, expect, it } from "vitest";
import {
  AD_HOC,
  canBook,
  canSendLink,
  linkBlocker,
  canSearch,
  initialScheduler,
  schedulerReducer,
  slotsByDay,
  type SchedulerEvent,
  type SchedulerPlanItem,
  type SchedulerState,
} from "./scheduler-machine";

const ITEMS: SchedulerPlanItem[] = [
  { id: "p1", name: "Tech", stageName: "Onsite", durationMinutes: 60, defaultInterviewerIds: ["u1", "u2"] },
  { id: "p2", name: "Culture", stageName: "Onsite", durationMinutes: 45, defaultInterviewerIds: [] },
];
const SLOT = { start: "2026-12-01T10:00:00.000Z", end: "2026-12-01T11:00:00.000Z" };
const MEMBERS = [{ userId: "u1", status: "connected" as const, availabilityKnown: true }];

const start = (connected = true) => initialScheduler({ planItems: ITEMS, connected });
const run = (state: SchedulerState, ...events: Parameters<typeof schedulerReducer>[1][]) =>
  events.reduce(schedulerReducer, state);

describe("scheduler-machine (IVT-045)", () => {
  it("starts on Book with the first plan item and its default panel, or on Record without a calendar", () => {
    expect(start()).toMatchObject({ tab: "book", planItemId: "p1", panel: ["u1", "u2"], durationMinutes: 60 });
    expect(start(false).tab).toBe("record");
    expect(initialScheduler({ planItems: [], connected: true })).toMatchObject({ planItemId: AD_HOC, panel: [] });
  });

  it("skips a plan interview the application already has open, and falls back to ad hoc when all are", () => {
    const first = { ...ITEMS[0], scheduled: true };
    expect(initialScheduler({ planItems: [first, ITEMS[1]], connected: true })).toMatchObject({
      planItemId: "p2",
      durationMinutes: 45,
    });
    expect(
      initialScheduler({ planItems: [first, { ...ITEMS[1], scheduled: true }], connected: true }),
    ).toMatchObject({ planItemId: AD_HOC, panel: [] });
  });

  it("takes the plan item's duration, and keeps a picked panel", () => {
    const s = run(start(), { type: "panel", panel: ["u3"] }, { type: "item", item: ITEMS[1] });
    expect(s).toMatchObject({ planItemId: "p2", durationMinutes: 45, panel: ["u3"] });
    expect(run(start(), { type: "panel", panel: [] }, { type: "item", item: ITEMS[0] }).panel).toEqual(["u1", "u2"]);
  });

  it("searches, shows the slots, and lets one be picked", () => {
    let s = run(start(), { type: "search" });
    expect(s.search.status).toBe("loading");
    expect(canSearch(s)).toBe(false);
    s = run(s, { type: "found", slots: [SLOT], members: MEMBERS });
    expect(s.search).toEqual({ status: "ready", slots: [SLOT], members: MEMBERS });
    expect(canBook(s)).toBe(false);
    s = run(s, { type: "pick", slot: SLOT });
    expect(canBook(s)).toBe(true);
  });

  it("throws the slots away when the panel, duration or interview changes", () => {
    const found = run(start(), { type: "search" }, { type: "found", slots: [SLOT], members: MEMBERS }, { type: "pick", slot: SLOT });
    const changes: SchedulerEvent[] = [
      { type: "panel", panel: ["u1"] },
      { type: "duration", minutes: 30 },
      { type: "item", item: ITEMS[1] },
    ];
    for (const e of changes) {
      const s = run(found, e);
      expect(s.search.status).toBe("idle");
      expect(s.slot).toBeNull();
    }
    // A name isn't part of the search.
    expect(run(found, { type: "name", name: "x" }).slot).toEqual(SLOT);
  });

  it("ignores a search that finished after the inputs changed", () => {
    const s = run(start(), { type: "search" }, { type: "panel", panel: ["u1"] }, { type: "found", slots: [SLOT], members: MEMBERS });
    expect(s.search.status).toBe("idle");
  });

  it("keeps the slots on a refused booking but drops a slot that was taken", () => {
    const ready = run(start(), { type: "search" }, { type: "found", slots: [SLOT], members: MEMBERS }, { type: "pick", slot: SLOT });
    const busy = run(ready, { type: "submit" });
    expect(busy.submitting).toBe(true);
    expect(canBook(busy)).toBe(false);
    const refused = run(busy, { type: "failed", error: "Nope", reason: "calendar_failed" });
    expect(refused).toMatchObject({ submitting: false, error: "Nope", slot: SLOT });
    const taken = run(busy, { type: "failed", error: "Taken", reason: "slot_taken" });
    expect(taken.slot).toBeNull();
    expect(taken.search).toMatchObject({ status: "ready", slots: [] });
  });

  it("needs a connected organizer, a panel and, ad hoc, a name to search or book", () => {
    expect(canSearch(start(false))).toBe(false);
    expect(canSearch(run(start(), { type: "panel", panel: [] }))).toBe(false);
    const adHoc = run(start(), { type: "item", item: null });
    expect(adHoc.planItemId).toBe(AD_HOC);
    expect(canSearch(adHoc)).toBe(true);
    const picked = run(adHoc, { type: "search" }, { type: "found", slots: [SLOT], members: MEMBERS }, { type: "pick", slot: SLOT });
    expect(canBook(picked)).toBe(false);
    expect(canBook(run(picked, { type: "name", name: "Coffee" }))).toBe(true);
  });

  it("switches tabs and clears the error", () => {
    const s = run(start(), { type: "search" }, { type: "searchFailed", error: "x" });
    expect(s.search).toEqual({ status: "error", error: "x" });
    expect(run(s, { type: "tab", tab: "record" })).toMatchObject({ tab: "record", error: null });
  });

  it("groups slots by day in the viewer's zone", () => {
    const days = slotsByDay(
      [
        { start: "2026-12-01T23:30:00.000Z", end: "2026-12-02T00:00:00.000Z" },
        { start: "2026-12-02T00:30:00.000Z", end: "2026-12-02T01:00:00.000Z" },
        { start: "2026-12-02T09:00:00.000Z", end: "2026-12-02T09:30:00.000Z" },
      ],
      "Asia/Kolkata",
    );
    expect(days.map((d) => d.slots.length)).toEqual([3]);
    expect(slotsByDay([SLOT, { ...SLOT, start: "2026-12-02T10:00:00.000Z" }], "UTC")).toHaveLength(2);
  });
});

describe("scheduler-machine: Send link (IVT-065)", () => {
  const TEMPLATES = [
    { id: "t1", name: "Invite", subject: "Pick a time", body: "Hi, {{scheduling_link}}" },
    { id: "t2", name: "Plain", subject: "Hello", body: "No link here" },
  ];
  const withTemplates = () => initialScheduler({ planItems: ITEMS, connected: true, templates: TEMPLATES });

  it("starts on the first template's subject and body, and switches templates", () => {
    expect(withTemplates()).toMatchObject({ templateId: "t1", subject: "Pick a time", body: "Hi, {{scheduling_link}}" });
    expect(start()).toMatchObject({ templateId: null, subject: "", body: "" });
    const s = run(withTemplates(), { type: "template", template: TEMPLATES[1] });
    expect(s).toMatchObject({ templateId: "t2", subject: "Hello", body: "No link here" });
  });

  it("sends with a template whose message has the link, a panel, and nothing in the way", () => {
    const s = withTemplates();
    expect(canSendLink(s, null)).toBe(true);
    expect(canSendLink(s, { reason: "panel_not_connected", userIds: ["u2"] })).toBe(false);
    expect(canSendLink(run(s, { type: "body", body: "no link" }), null)).toBe(false);
    expect(canSendLink(run(s, { type: "subject", subject: "  " }), null)).toBe(false);
    expect(canSendLink(run(s, { type: "panel", panel: [] }), null)).toBe(false);
    expect(canSendLink(run(s, { type: "submit" }), null)).toBe(false);
    expect(canSendLink(start(), null)).toBe(false);
    expect(canSendLink(run(s, { type: "item", item: null }), null)).toBe(false);
  });

  it("needs the member's calendar, an emailable candidate and every panel member connected", () => {
    const calendar = { own: "active" as const, members: { u1: "connected" as const, u2: "connected" as const }, candidateInvitable: true };
    expect(linkBlocker(calendar, ["u1", "u2"])).toBeNull();
    expect(linkBlocker({ ...calendar, own: null }, ["u1"])).toEqual({ reason: "not_connected", userIds: [] });
    expect(linkBlocker({ ...calendar, own: "error" }, ["u1"])).toEqual({ reason: "organizer_reconnect", userIds: [] });
    expect(linkBlocker({ ...calendar, candidateInvitable: false }, ["u1"])).toEqual({ reason: "no_candidate_email", userIds: [] });
    expect(linkBlocker({ ...calendar, members: { u1: "connected", u2: "error" } }, ["u1", "u2", "u3"])).toEqual({
      reason: "panel_not_connected",
      userIds: ["u2", "u3"],
    });
  });
});
