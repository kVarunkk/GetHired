import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { FakeCalendarProvider } from "@/test/utils/calendar";
import { CalendarError } from "@/helpers/calendar/provider";
import type { EventDetails } from "@/helpers/calendar/events";
import { bookByToken, cancelByToken, linkSlots, rescheduleByToken, resolveLink, type SelfSchedulingDeps } from "./self-scheduling";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
// Each connection's token is `tok:<connection id>`, which the fake treats as that calendar.
vi.mock("@/helpers/calendar/tokens", () => ({
  withCalendarAuth: (_admin: unknown, connectionId: string, fn: (token: string) => Promise<unknown>) =>
    fn(`tok:${connectionId}`),
}));

const TOKEN = "t".repeat(43);
const JOB = "b0000000-0000-4000-8000-0000000000a1";
const APP = "e0000000-0000-4000-8000-000000000001";
const INTERVIEW = "f1000000-0000-4000-8000-000000000001";
const RITA = "c2000000-0000-4000-8000-000000000001";
// Monday. With the default 10:00–18:00 UTC hours, the first slot is Tuesday 10:00.
const NOW = new Date("2026-11-16T08:00:00.000Z");
const TUE_10 = "2026-11-17T10:00:00.000Z";
const TUE_1030 = "2026-11-17T10:30:00.000Z";

let admin: SupabaseMock;
let provider: FakeCalendarProvider;
let deps: SelfSchedulingDeps;

beforeEach(() => {
  admin = createSupabaseMock();
  provider = new FakeCalendarProvider();
  deps = { admin: admin.client, provider };
});

const context = (overrides: Record<string, unknown> = {}) => ({
  id: INTERVIEW,
  application_id: APP,
  company_id: "c0000000-0000-4000-8000-000000000001",
  job_post_id: JOB,
  status: "awaiting_candidate",
  duration_minutes: 30,
  starts_at: null,
  organizer_user_id: RITA,
  panel: [RITA],
  cached_slots: null,
  ...overrides,
});

const details = (overrides: Partial<EventDetails> = {}): EventDetails => ({
  id: INTERVIEW,
  application_id: APP,
  job_post_id: JOB,
  company_id: "c0000000-0000-4000-8000-000000000001",
  name: "Intro call",
  status: "scheduled",
  source: "link",
  starts_at: TUE_10,
  ends_at: "2026-11-17T10:30:00.000Z",
  time_zone: "Europe/London",
  meeting_url: null,
  provider_event_id: null,
  organizer_user_id: RITA,
  organizer_connection_id: "conn-rita",
  candidate_is_attendee: true,
  candidate_name: "Ada",
  candidate_email: "ada@example.test",
  job_title: "Backend Engineer",
  company_name: "Acme",
  panel: [{ user_id: RITA, email: "rita@acme.test", name: "Rita", response: "needs_action" }],
  ...overrides,
});

/** One panel lookup: the job, Rita's connection, no saved hours. */
function queuePanel(connections = [{ id: "conn-rita", user_id: RITA }]) {
  admin.queue("job_postings", { data: { company_id: "c0000000-0000-4000-8000-000000000001", company_info: { time_zone: "UTC" } }, error: null });
  admin.queue("calendar_connections", { data: connections, error: null });
  admin.queue("member_availability", { data: [], error: null });
}

const rpcArgs = (fn: string, i = 0) => admin.callsFor(fn)[i]?.chain[0].args[1] as Record<string, unknown>;

describe("resolveLink", () => {
  it("returns the public view, or null for a link that opens nothing", async () => {
    const pub = createSupabaseMock();
    pub.queueRpc("resolve_scheduling_token", { data: { ok: true, status: "awaiting_candidate", interview_name: "Intro" }, error: null });
    pub.queueRpc("resolve_scheduling_token", { data: { ok: false, reason: "not_found" }, error: null });
    expect(await resolveLink(pub.client, TOKEN)).toEqual({ status: "awaiting_candidate", interview_name: "Intro" });
    expect(await resolveLink(pub.client, TOKEN)).toBeNull();
  });
});

describe("linkSlots (IV-REQ-021, the 2-minute cache)", () => {
  it("serves fresh cached slots without calling Google", async () => {
    const cached = [{ start: TUE_10, end: TUE_1030 }];
    admin.queueRpc("scheduling_link_context", { data: context({ cached_slots: cached }), error: null });
    expect(await linkSlots(deps, TOKEN, NOW)).toEqual(cached);
    expect(provider.calls).toEqual([]);
    expect(admin.callsFor("save_scheduling_slots")).toHaveLength(0);
  });

  it("computes the panel's slots when the cache is stale, and caches them", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    provider.setBusy("tok:conn-rita", [{ start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T12:00:00.000Z" }]);
    const slots = await linkSlots(deps, TOKEN, NOW);
    // 12:00 + the 10-minute buffer: the first slot is 12:30.
    expect(slots?.[0]).toEqual({ start: "2026-11-17T12:30:00.000Z", end: "2026-11-17T13:00:00.000Z" });
    expect(rpcArgs("save_scheduling_slots")).toEqual({ p_id: INTERVIEW, p_slots: slots });
  });

  it("offers nothing while a panel member's calendar can't be read", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    provider.fail("freeBusy", new CalendarError("error", 500));
    expect(await linkSlots(deps, TOKEN, NOW)).toEqual([]);
  });

  it("is null for a link that opens nothing", async () => {
    admin.queueRpc("scheduling_link_context", { data: null, error: null });
    expect(await linkSlots(deps, TOKEN, NOW)).toBeNull();
  });
});

describe("bookByToken", () => {
  it("re-checks free/busy, books, then creates the event on the organizer's calendar", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    admin.queueRpc("book_by_token", { data: { ok: true, starts_at: TUE_10 }, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });

    expect(await bookByToken(deps, TOKEN, { startsAt: TUE_10, timeZone: "Europe/Paris" }, NOW)).toEqual({
      ok: true,
      startsAt: TUE_10,
    });
    expect(rpcArgs("book_by_token")).toEqual({ p_token: TOKEN, p_starts_at: TUE_10, p_time_zone: "Europe/Paris" });
    const [created] = provider.callsOf("createEvent");
    expect(created.token).toBe("tok:conn-rita");
    expect(created.args[0]).toMatchObject({
      interviewId: INTERVIEW,
      attendees: [{ email: "rita@acme.test" }, { email: "ada@example.test" }],
    });
    const update = admin.callsFor("scheduled_interviews")[0].chain;
    expect(update.find((c) => c.method === "update")?.args[0]).toMatchObject({
      provider_event_id: "evt_1",
      meeting_url: "https://meet.google.com/fak-e1",
    });
    expect(update).toContainEqual({ method: "eq", args: ["status", "scheduled"] });
  });

  it("refuses a time that was just taken, before booking", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    provider.setBusy("tok:conn-rita", [{ start: TUE_10, end: TUE_1030 }]);
    const result = await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, NOW);
    expect(result).toEqual({ ok: false, reason: "slot_taken", error: "That time was just taken. Pick another one." });
    expect(admin.callsFor("book_by_token")).toHaveLength(0);
  });

  it("accepts a slot that was offered a little while ago", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    admin.queueRpc("book_by_token", { data: { ok: true, starts_at: TUE_10 }, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    // An hour later, Tuesday 10:00 is under 24 hours away, but was on the page.
    const later = new Date(NOW.getTime() + 60 * 60_000 + 30 * 60_000);
    expect((await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, later)).ok).toBe(true);
  });

  it("undoes the booking when Google refuses, so the link works again", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    admin.queueRpc("book_by_token", { data: { ok: true, starts_at: TUE_10 }, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    provider.fail("createEvent", new CalendarError("forbidden", 403));
    expect(await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, NOW)).toMatchObject({ ok: false, reason: "calendar_failed" });
    expect(rpcArgs("return_interview_to_link")).toEqual({ p_id: INTERVIEW, p_reason: "calendar_failed" });
  });

  it("refuses an unknown or already booked link", async () => {
    admin.queueRpc("scheduling_link_context", { data: null, error: null });
    expect(await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, NOW)).toMatchObject({ reason: "not_found" });
    admin.queueRpc("scheduling_link_context", { data: context({ status: "scheduled", starts_at: TUE_10 }), error: null });
    expect(await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, NOW)).toMatchObject({ reason: "already_booked" });
    expect(provider.calls).toEqual([]);
  });

  it("passes the RPC's refusal on", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    queuePanel();
    admin.queueRpc("book_by_token", { data: { ok: false, reason: "invalid_time" }, error: null });
    expect(await bookByToken(deps, TOKEN, { startsAt: TUE_10 }, NOW)).toMatchObject({ ok: false, reason: "invalid_time" });
    expect(provider.callsOf("createEvent")).toEqual([]);
  });
});

describe("rescheduleByToken", () => {
  const booked = () => context({ status: "scheduled", starts_at: TUE_10 });

  it("isn't blocked by the interview's own time, and moves the event", async () => {
    const { eventId } = await provider.createEvent("tok:conn-rita", {
      interviewId: INTERVIEW,
      summary: "x",
      description: "x",
      start: TUE_10,
      end: TUE_1030,
      timeZone: "UTC",
      attendees: [],
    });
    admin.queueRpc("scheduling_link_context", { data: booked(), error: null });
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: eventId }), error: null });
    queuePanel();
    admin.queueRpc("reschedule_by_token", {
      data: { ok: true, starts_at: TUE_1030, ends_at: "2026-11-17T11:00:00.000Z" },
      error: null,
    });

    expect(await rescheduleByToken(deps, TOKEN, { startsAt: TUE_1030 }, NOW)).toEqual({ ok: true, startsAt: TUE_1030 });
    expect(rpcArgs("reschedule_by_token")).toEqual({ p_token: TOKEN, p_starts_at: TUE_1030 });
    expect(provider.events.get(eventId)).toMatchObject({ start: TUE_1030, end: "2026-11-17T11:00:00.000Z" });
  });

  it("asks the candidate to reply to the invite when the organizer is disconnected", async () => {
    admin.queueRpc("scheduling_link_context", { data: booked(), error: null });
    admin.queueRpc("interview_event_details", { data: details({ organizer_connection_id: null, provider_event_id: "evt" }), error: null });
    expect(await rescheduleByToken(deps, TOKEN, { startsAt: TUE_1030 }, NOW)).toMatchObject({ ok: false, reason: "cant_change" });
    expect(admin.callsFor("reschedule_by_token")).toHaveLength(0);
  });

  it("queues the event update when Google can't be reached", async () => {
    admin.queueRpc("scheduling_link_context", { data: booked(), error: null });
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: "evt_gone" }), error: null });
    queuePanel();
    admin.queueRpc("reschedule_by_token", {
      data: { ok: true, starts_at: TUE_1030, ends_at: "2026-11-17T11:00:00.000Z" },
      error: null,
    });
    provider.fail("updateEvent", new CalendarError("error", 503));
    expect((await rescheduleByToken(deps, TOKEN, { startsAt: TUE_1030 }, NOW)).ok).toBe(true);
    expect(rpcArgs("queue_interview_calendar_op")).toEqual({ p_interview_id: INTERVIEW, p_op: "update" });
  });

  it("refuses a link that isn't booked", async () => {
    admin.queueRpc("scheduling_link_context", { data: context(), error: null });
    expect(await rescheduleByToken(deps, TOKEN, { startsAt: TUE_1030 }, NOW)).toMatchObject({ reason: "not_booked" });
  });
});

describe("cancelByToken", () => {
  it("cancels and deletes the event on the organizer's calendar", async () => {
    const { eventId } = await provider.createEvent("tok:conn-rita", {
      interviewId: INTERVIEW,
      summary: "x",
      description: "x",
      start: TUE_10,
      end: TUE_1030,
      timeZone: "UTC",
      attendees: [],
    });
    admin.queueRpc("cancel_by_token", { data: { ok: true, applied: true, id: INTERVIEW, provider_event_id: eventId }, error: null });
    admin.queueRpc("interview_event_details", { data: details({ status: "awaiting_candidate" }), error: null });
    expect(await cancelByToken(deps, TOKEN)).toEqual({ ok: true, startsAt: null });
    expect(provider.events.get(eventId)?.deleted).toBe(true);
    expect(admin.callsFor("queue_interview_calendar_op")).toHaveLength(0);
  });

  it("queues the delete with the event's id when Google can't be reached", async () => {
    admin.queueRpc("cancel_by_token", { data: { ok: true, applied: true, id: INTERVIEW, provider_event_id: "evt_x" }, error: null });
    admin.queueRpc("interview_event_details", { data: details({ status: "awaiting_candidate" }), error: null });
    provider.fail("deleteEvent", new CalendarError("error", 503));
    expect((await cancelByToken(deps, TOKEN)).ok).toBe(true);
    expect(rpcArgs("queue_interview_calendar_op")).toEqual({ p_interview_id: INTERVIEW, p_op: "delete", p_event_id: "evt_x" });
  });

  it("explains the 4-hour cutoff", async () => {
    admin.queueRpc("cancel_by_token", { data: { ok: false, reason: "too_late" }, error: null });
    const result = await cancelByToken(deps, TOKEN);
    expect(result).toMatchObject({ ok: false, reason: "too_late" });
    if (!result.ok) expect(result.error).toContain("Reply to the calendar invite");
    expect(provider.calls).toEqual([]);
  });
});
