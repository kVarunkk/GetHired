import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { FakeCalendarProvider } from "@/test/utils/calendar";
import { CalendarError } from "@/helpers/calendar/provider";
import type { EventDetails } from "@/helpers/calendar/events";
import { syncCalendarInterviews } from "./calendar-sync";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
// Each connection's token is `tok:<connection id>`, which the fake treats as that calendar.
vi.mock("@/helpers/calendar/tokens", () => ({
  withCalendarAuth: (_admin: unknown, connectionId: string, fn: (token: string) => Promise<unknown>) =>
    fn(`tok:${connectionId}`),
}));

const INTERVIEW = "f1000000-0000-4000-8000-000000000001";
const RITA = "c2000000-0000-4000-8000-000000000001";
const VERA = "c7000000-0000-4000-8000-000000000001";
const CONN = "a1000000-0000-4000-8000-000000000001";
const TOKEN = `tok:${CONN}`;
const START = "2026-12-01T10:00:00.000Z";
const END = "2026-12-01T11:00:00.000Z";

let admin: SupabaseMock;
let provider: FakeCalendarProvider;
let eventId: string;

const details = (over: Partial<EventDetails> = {}): EventDetails => ({
  id: INTERVIEW,
  application_id: "e0000000-0000-4000-8000-000000000001",
  job_post_id: "b0000000-0000-4000-8000-0000000000a1",
  company_id: "a0000000-0000-4000-8000-000000000001",
  name: "Tech",
  status: "scheduled",
  source: "booked",
  starts_at: START,
  ends_at: END,
  time_zone: "UTC",
  meeting_url: null,
  provider_event_id: eventId,
  organizer_user_id: RITA,
  organizer_connection_id: CONN,
  candidate_is_attendee: false,
  candidate_name: null,
  candidate_email: null,
  job_title: null,
  company_name: null,
  panel: [
    { user_id: RITA, email: "rita@example.test", name: "Rita", response: "needs_action" },
    { user_id: VERA, email: "vera@example.test", name: "Vera", response: "needs_action" },
  ],
  ...over,
});

/** One due-for-sync interview: the listing, then its event details. */
function queueOne(over: Partial<EventDetails> = {}) {
  admin.queue("scheduled_interviews", { data: [{ id: INTERVIEW }], error: null });
  admin.queueRpc("interview_event_details", { data: details(over), error: null });
}

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  provider = new FakeCalendarProvider();
  ({ eventId } = await provider.createEvent(TOKEN, {
    interviewId: INTERVIEW,
    summary: "Tech",
    description: "",
    start: START,
    end: END,
    timeZone: "UTC",
    attendees: [{ email: "rita@example.test" }, { email: "vera@example.test" }],
  }));
  admin.queueRpc("complete_due_interviews", { data: ["x1"], error: null });
  admin.queueRpc("expire_interview_links", { data: [], error: null });
});

const NOW = new Date("2026-11-20T08:00:00.000Z");

describe("syncCalendarInterviews (IVT-046)", () => {
  it("completes due interviews, expires links, and leaves an unchanged event alone", async () => {
    queueOne();
    const summary = await syncCalendarInterviews(admin.client, provider, NOW);
    expect(summary).toEqual({ completed: 1, checked: 1, moved: 0, cancelled: 0, responses: 0, skipped: 0, expired: 0, failures: [] });
    expect(admin.callsFor("move_interview_from_calendar")).toHaveLength(0);
    expect(admin.callsFor("cancel_interview_as_system")).toHaveLength(0);
    // Only upcoming scheduled interviews with an event.
    const chain = admin.callsFor("scheduled_interviews")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["status", "scheduled"] });
    expect(chain).toContainEqual({ method: "not", args: ["provider_event_id", "is", null] });
    expect(chain).toContainEqual({ method: "gt", args: ["starts_at", NOW.toISOString()] });
  });

  it("moves the interview when the event was moved in Google", async () => {
    provider.moveInGoogle(eventId, "2026-12-02T10:00:00.000Z", "2026-12-02T11:00:00.000Z");
    queueOne();
    admin.queueRpc("move_interview_from_calendar", { data: { ok: true, applied: true }, error: null });
    const summary = await syncCalendarInterviews(admin.client, provider, NOW);
    expect(summary.moved).toBe(1);
    expect(admin.callsFor("move_interview_from_calendar")[0].chain[0].args[1]).toEqual({
      p_id: INTERVIEW,
      p_starts_at: "2026-12-02T10:00:00.000Z",
      p_ends_at: "2026-12-02T11:00:00.000Z",
    });
  });

  it("cancels the interview when the event was deleted in Google", async () => {
    provider.deleteInGoogle(eventId);
    queueOne();
    admin.queueRpc("cancel_interview_as_system", { data: { ok: true, applied: true }, error: null });
    expect((await syncCalendarInterviews(admin.client, provider, NOW)).cancelled).toBe(1);
    expect(admin.callsFor("cancel_interview_as_system")[0].chain[0].args[1]).toEqual({ p_id: INTERVIEW, p_reason: "calendar" });
  });

  it("stores the panel's answers, matching emails without case", async () => {
    provider.respond(eventId, "Vera@Example.test", "declined");
    queueOne();
    admin.queue("scheduled_interview_panel", { data: null, error: null });
    expect((await syncCalendarInterviews(admin.client, provider, NOW)).responses).toBe(1);
    const chain = admin.callsFor("scheduled_interview_panel")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [{ response: "declined" }] });
    expect(chain).toContainEqual({ method: "eq", args: ["interview_id", INTERVIEW] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", VERA] });
  });

  it("is idempotent: a second run with the answers stored changes nothing", async () => {
    provider.respond(eventId, "vera@example.test", "declined");
    queueOne({
      panel: [
        { user_id: RITA, email: "rita@example.test", name: "Rita", response: "needs_action" },
        { user_id: VERA, email: "vera@example.test", name: "Vera", response: "declined" },
      ],
    });
    expect((await syncCalendarInterviews(admin.client, provider, NOW)).responses).toBe(0);
    expect(admin.callsFor("scheduled_interview_panel")).toHaveLength(0);
  });

  it("skips an interview whose organizer is disconnected (the banner asks to reschedule)", async () => {
    queueOne({ organizer_connection_id: null });
    const summary = await syncCalendarInterviews(admin.client, provider, NOW);
    expect(summary).toMatchObject({ skipped: 1, failures: [] });
    expect(provider.callsOf("getEvent")).toHaveLength(0);
  });

  it("keeps going after one interview fails, and counts a dead grant as skipped", async () => {
    const OTHER = "f1000000-0000-4000-8000-000000000002";
    admin.queue("scheduled_interviews", { data: [{ id: INTERVIEW }, { id: OTHER }, { id: "f3" }], error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    admin.queueRpc("interview_event_details", { data: details({ id: OTHER }), error: null });
    admin.queueRpc("interview_event_details", { data: details({ id: "f3" }), error: null });
    provider.fail("getEvent", new CalendarError("rate_limited", 429));
    provider.fail("getEvent", new CalendarError("invalid_grant", 400));
    const summary = await syncCalendarInterviews(admin.client, provider, NOW);
    expect(summary).toMatchObject({ checked: 3, skipped: 1 });
    expect(summary.failures).toEqual([`${INTERVIEW}: Calendar rate_limited (429)`]);
  });
});
