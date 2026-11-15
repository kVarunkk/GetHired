import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { FakeCalendarProvider } from "@/test/utils/calendar";
import { CalendarError } from "@/helpers/calendar/provider";
import type { EventDetails } from "@/helpers/calendar/events";
import {
  bookInterview,
  findInterviewSlots,
  syncCancelledInterview,
  syncUpdatedInterview,
  type SchedulingDeps,
} from "./scheduling";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
// Each connection's token is `tok:<connection id>`, which the fake treats as that calendar.
vi.mock("@/helpers/calendar/tokens", () => ({
  withCalendarAuth: (_admin: unknown, connectionId: string, fn: (token: string) => Promise<unknown>) =>
    fn(`tok:${connectionId}`),
}));

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const APP = "e0000000-0000-4000-8000-000000000001";
const INTERVIEW = "f1000000-0000-4000-8000-000000000001";
const RITA = "c2000000-0000-4000-8000-000000000001";
const VERA = "c7000000-0000-4000-8000-000000000001";
const OWEN = "c1000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-16T08:00:00.000Z");

let rls: SupabaseMock;
let admin: SupabaseMock;
let provider: FakeCalendarProvider;
let deps: SchedulingDeps;

beforeEach(() => {
  rls = createSupabaseMock();
  admin = createSupabaseMock();
  provider = new FakeCalendarProvider();
  deps = { supabase: rls.client, admin: admin.client, provider, userId: RITA };
});

const details = (overrides: Partial<EventDetails> = {}): EventDetails => ({
  id: INTERVIEW,
  application_id: APP,
  job_post_id: JOB,
  company_id: "c0000000-0000-4000-8000-000000000001",
  name: "Technical screen",
  status: "scheduled",
  source: "booked",
  starts_at: "2026-11-18T10:00:00.000Z",
  ends_at: "2026-11-18T10:45:00.000Z",
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
  panel: [
    { user_id: RITA, email: "rita@acme.test", name: "Rita", response: "needs_action" },
    { user_id: VERA, email: "vera@acme.test", name: "Vera", response: "needs_action" },
  ],
  ...overrides,
});

describe("findInterviewSlots (IVT-042)", () => {
  function setup({ ownStatus = "active" as string | null } = {}) {
    rls.queueRpc("panel_calendar_status", {
      data: [
        { user_id: RITA, status: "connected" },
        { user_id: VERA, status: "unknown" },
      ],
      error: null,
    });
    rls.queue("calendar_connections", { data: ownStatus ? { status: ownStatus } : null, error: null });
    admin.queue("job_postings", { data: { company_id: "c0000000-0000-4000-8000-000000000001", company_info: { time_zone: "UTC" } }, error: null });
    admin.queue("calendar_connections", { data: [{ id: "conn-rita", user_id: RITA }], error: null });
    admin.queue("member_availability", { data: [], error: null });
  }

  it("merges the connected members' busy times and flags the rest as unknown", async () => {
    setup();
    provider.setBusy("tok:conn-rita", [{ start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T18:00:00.000Z" }]);
    const result = await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA, VERA], durationMinutes: 45 }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members).toEqual([
      { userId: RITA, status: "connected", availabilityKnown: true },
      { userId: VERA, status: "unknown", availabilityKnown: false },
    ]);
    expect(result.slots.some((s) => s.start.startsWith("2026-11-17"))).toBe(false);
    expect(result.slots[0].start).toBe("2026-11-18T10:00:00.000Z");
    expect(provider.callsOf("freeBusy")).toHaveLength(1);
    expect(rls.callsFor("panel_calendar_status")[0].chain[0].args[1]).toEqual({ p_job_post_id: JOB, p_user_ids: [RITA, VERA] });
  });

  it("shows a member whose free/busy fails as unknown instead of failing the search", async () => {
    setup();
    provider.fail("freeBusy", new CalendarError("error", 500));
    const result = await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA, VERA], durationMinutes: 45 }, NOW);
    expect(result.ok && result.members[0]).toEqual({ userId: RITA, status: "unknown", availabilityKnown: false });
    expect(result.ok && result.slots.length).toBeGreaterThan(0);
  });

  it("needs a connected organizer", async () => {
    setup({ ownStatus: null });
    expect(await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA, VERA], durationMinutes: 45 }, NOW)).toEqual({
      ok: false,
      reason: "not_connected",
      error: "Connect your Google Calendar to book interviews.",
    });
    setup({ ownStatus: "error" });
    expect(
      (await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA, VERA], durationMinutes: 45 }, NOW)).ok === false,
    ).toBe(true);
  });

  it("is forbidden when the RPC answers nothing (no scheduling.manage for the job)", async () => {
    rls.queueRpc("panel_calendar_status", { data: [], error: null });
    expect(await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA], durationMinutes: 45 }, NOW)).toMatchObject({
      ok: false,
      reason: "forbidden",
      error: "Your role can't schedule interviews for this job.",
    });
  });

  it("refuses someone outside the company", async () => {
    rls.queueRpc("panel_calendar_status", { data: [{ user_id: RITA, status: "connected" }], error: null });
    expect(await findInterviewSlots(deps, { jobPostId: JOB, panel: [RITA, OWEN], durationMinutes: 45 }, NOW)).toMatchObject({
      reason: "invalid_panel",
    });
  });
});

describe("bookInterview (IVT-043)", () => {
  const input = { applicationId: APP, panel: [RITA, VERA], startsAt: "2026-11-18T10:00:00.000Z", name: "Technical screen", durationMinutes: 45 };

  beforeEach(() => {
    rls.queue("member_availability", { data: { time_zone: "Europe/London" }, error: null });
  });

  it("books the row, then creates the event with the panel and the candidate, and stores the event", async () => {
    rls.queueRpc("book_interview", { data: { ok: true, id: INTERVIEW, application_id: APP, candidate_is_attendee: true }, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });

    const result = await bookInterview(deps, input);

    expect(result).toEqual({ ok: true, id: INTERVIEW, applicationId: APP, candidateInvited: true, meetingUrl: "https://meet.google.com/fak-e1" });
    expect(rls.callsFor("book_interview")[0].chain[0].args[1]).toEqual({
      p_application_id: APP,
      p_panel: [RITA, VERA],
      p_starts_at: input.startsAt,
      p_name: "Technical screen",
      p_duration_minutes: 45,
      p_time_zone: "Europe/London",
    });
    const [created] = provider.callsOf("createEvent");
    expect(created.token).toBe("tok:conn-rita");
    const event = created.args[0] as { attendees: { email: string }[]; timeZone: string; interviewId: string };
    expect(event.attendees.map((a) => a.email)).toEqual(["rita@acme.test", "vera@acme.test", "ada@example.test"]);
    expect(event.timeZone).toBe("Europe/London");
    expect(event.interviewId).toBe(INTERVIEW);

    const save = admin.callsFor("scheduled_interviews")[0].chain;
    expect(save).toContainEqual({ method: "eq", args: ["status", "scheduled"] });
    expect(save.find((s) => s.method === "update")!.args[0]).toMatchObject({
      provider_event_id: "evt_1",
      meeting_url: "https://meet.google.com/fak-e1",
    });
  });

  it("leaves the candidate off the invite when they can't get one (D20), and says so", async () => {
    rls.queueRpc("book_interview", { data: { ok: true, id: INTERVIEW, application_id: APP }, error: null });
    admin.queueRpc("interview_event_details", { data: details({ candidate_is_attendee: false, candidate_email: null }), error: null });
    const result = await bookInterview(deps, input);
    expect(result).toMatchObject({ ok: true, candidateInvited: false });
    const event = provider.callsOf("createEvent")[0].args[0] as { attendees: { email: string }[] };
    expect(event.attendees.map((a) => a.email)).toEqual(["rita@acme.test", "vera@acme.test"]);
  });

  it("cancels the row when Google refuses, so no scheduled interview is left without an event", async () => {
    rls.queueRpc("book_interview", { data: { ok: true, id: INTERVIEW, application_id: APP }, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    provider.fail("createEvent", new CalendarError("forbidden", 403));

    expect(await bookInterview(deps, input)).toMatchObject({ ok: false, reason: "calendar_failed" });
    expect(admin.callsFor("cancel_interview_as_system")[0].chain[0].args[1]).toEqual({ p_id: INTERVIEW, p_reason: "calendar_failed" });
    expect(admin.callsFor("scheduled_interviews")).toEqual([]);
  });

  it("passes on the RPC's refusals without calling Google", async () => {
    rls.queueRpc("book_interview", { data: { ok: false, reason: "not_connected" }, error: null });
    expect(await bookInterview(deps, input)).toMatchObject({ ok: false, error: "Connect your Google Calendar to book interviews." });
    rls.queue("member_availability", { data: null, error: null });
    rls.queueRpc("book_interview", { data: { ok: false, reason: "closed" }, error: null });
    expect(await bookInterview(deps, input)).toMatchObject({ ok: false, reason: "closed" });
    expect(provider.calls).toEqual([]);
  });

  it("validates before calling anything", async () => {
    expect(await bookInterview(deps, { ...input, panel: [] })).toMatchObject({ ok: false });
    expect(rls.callsFor("book_interview")).toEqual([]);
  });
});

describe("syncUpdatedInterview (IVT-044)", () => {
  async function bookedEvent() {
    const { eventId } = await provider.createEvent("tok:conn-rita", {
      interviewId: INTERVIEW,
      summary: "x",
      description: "",
      start: "2026-11-18T10:00:00.000Z",
      end: "2026-11-18T10:45:00.000Z",
      timeZone: "UTC",
      attendees: [{ email: "rita@acme.test" }],
    });
    provider.calls.length = 0;
    return eventId;
  }

  it("patches the time and the attendees on the organizer's calendar", async () => {
    const eventId = await bookedEvent();
    admin.queueRpc("interview_event_details", {
      data: details({ provider_event_id: eventId, starts_at: "2026-11-19T11:00:00.000Z", ends_at: "2026-11-19T11:45:00.000Z" }),
      error: null,
    });
    expect(await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: true })).toEqual({});
    const [call] = provider.callsOf("updateEvent");
    expect(call.token).toBe("tok:conn-rita");
    expect(call.args[1]).toMatchObject({
      start: "2026-11-19T11:00:00.000Z",
      end: "2026-11-19T11:45:00.000Z",
      attendees: [{ email: "rita@acme.test" }, { email: "vera@acme.test" }, { email: "ada@example.test" }].map((a) =>
        expect.objectContaining(a),
      ),
    });
  });

  it("does nothing for a manual interview or one without an event", async () => {
    admin.queueRpc("interview_event_details", { data: details({ source: "manual" }), error: null });
    expect(await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: false })).toEqual({});
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: null }), error: null });
    expect(await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: false })).toEqual({});
    expect(await syncUpdatedInterview(deps, INTERVIEW, { time: false, panel: false })).toEqual({});
    expect(provider.calls).toEqual([]);
  });

  it("recreates the event on the acting member's calendar when the organizer is disconnected (IV-REQ-023b)", async () => {
    admin.queueRpc("interview_event_details", {
      data: details({ provider_event_id: "evt_old", organizer_user_id: OWEN, organizer_connection_id: null }),
      error: null,
    });
    admin.queue("calendar_connections", { data: { id: "conn-rita" }, error: null });
    expect(await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: false })).toEqual({});
    expect(provider.callsOf("createEvent")[0].token).toBe("tok:conn-rita");
    const update = admin.callsFor("scheduled_interviews")[0].chain.find((s) => s.method === "update")!.args[0];
    expect(update).toMatchObject({ provider_event_id: "evt_1", organizer_user_id: RITA });
  });

  it("warns when nobody connected can take the event over", async () => {
    admin.queueRpc("interview_event_details", {
      data: details({ provider_event_id: "evt_old", organizer_connection_id: null }),
      error: null,
    });
    admin.queue("calendar_connections", { data: null, error: null });
    expect((await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: false })).calendarWarning).toMatch(/disconnected/);
  });

  it("warns, without failing, when Google refuses the patch", async () => {
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: "evt_missing" }), error: null });
    expect((await syncUpdatedInterview(deps, INTERVIEW, { time: true, panel: false })).calendarWarning).toMatch(
      /couldn't be updated/,
    );
  });
});

describe("syncCancelledInterview (IVT-044)", () => {
  it("deletes the event on the organizer's calendar", async () => {
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: "evt_9", status: "cancelled" }), error: null });
    expect(await syncCancelledInterview(deps, INTERVIEW)).toEqual({});
    expect(provider.callsOf("deleteEvent")[0]).toMatchObject({ token: "tok:conn-rita", args: ["evt_9"] });
  });

  it("queues a failed delete for the calendar ops worker", async () => {
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: "evt_9", status: "cancelled" }), error: null });
    provider.fail("deleteEvent", new CalendarError("rate_limited", 429));
    expect(await syncCancelledInterview(deps, INTERVIEW)).toEqual({});
    expect(admin.callsFor("queue_interview_calendar_op")[0].chain[0].args[1]).toEqual({ p_interview_id: INTERVIEW, p_op: "delete" });
  });

  it("does nothing without an event, and warns when the organizer is disconnected", async () => {
    admin.queueRpc("interview_event_details", { data: details({ provider_event_id: null }), error: null });
    expect(await syncCancelledInterview(deps, INTERVIEW)).toEqual({});
    admin.queueRpc("interview_event_details", {
      data: details({ provider_event_id: "evt_9", organizer_connection_id: null }),
      error: null,
    });
    expect((await syncCancelledInterview(deps, INTERVIEW)).calendarWarning).toMatch(/still there/);
    expect(provider.calls).toEqual([]);
  });
});
