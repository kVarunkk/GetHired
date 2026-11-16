import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { FakeCalendarProvider } from "@/test/utils/calendar";
import { CalendarError } from "@/helpers/calendar/provider";
import type { EventDetails } from "@/helpers/calendar/events";
import { CALENDAR_OPS_MAX_READS, CALENDAR_OPS_QUEUE, processCalendarOps } from "./calendar-ops";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/calendar/tokens", () => ({
  withCalendarAuth: (_admin: unknown, connectionId: string, fn: (token: string) => Promise<unknown>) =>
    fn(`tok:${connectionId}`),
}));

const INTERVIEW = "f1000000-0000-4000-8000-000000000001";
const CONN = "a1000000-0000-4000-8000-000000000001";
const TOKEN = `tok:${CONN}`;
const START = "2026-12-01T10:00:00.000Z";
const END = "2026-12-01T11:00:00.000Z";

let admin: SupabaseMock;
let provider: FakeCalendarProvider;
let eventId: string;

const details = (over: Partial<EventDetails> = {}): EventDetails => ({
  id: INTERVIEW,
  application_id: "e1",
  job_post_id: "j1",
  company_id: "c1",
  name: "Tech",
  status: "scheduled",
  source: "booked",
  starts_at: "2026-12-03T10:00:00.000Z",
  ends_at: "2026-12-03T11:00:00.000Z",
  time_zone: "UTC",
  meeting_url: null,
  provider_event_id: eventId,
  organizer_user_id: "u1",
  organizer_connection_id: CONN,
  candidate_is_attendee: false,
  candidate_name: null,
  candidate_email: null,
  job_title: null,
  company_name: null,
  panel: [{ user_id: "u1", email: "rita@example.test", name: "Rita", response: "accepted" }],
  ...over,
});

const message = (op: "delete" | "update", msgId = 1, readCt = 1) => ({
  msg_id: msgId,
  read_ct: readCt,
  message: { op, interview_id: INTERVIEW, company_id: "c1", organizer_user_id: "u1", provider_event_id: eventId },
});

function queueBatch(...messages: ReturnType<typeof message>[]) {
  admin.queueRpc("read", { data: messages, error: null }, "pgmq_public");
}
const archived = () =>
  admin.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

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
    attendees: [{ email: "rita@example.test" }],
  }));
});

describe("processCalendarOps (IVT-047)", () => {
  it("deletes the event and archives the message", async () => {
    queueBatch(message("delete"));
    admin.queueRpc("interview_event_details", { data: details({ status: "cancelled" }), error: null });
    expect(await processCalendarOps(admin.client, provider)).toEqual({ done: 1, dropped: 0, retrying: 0, gaveUp: [] });
    expect(provider.events.get(eventId)?.deleted).toBe(true);
    expect(archived()).toEqual([1]);
    expect(admin.callsFor("read")[0].chain[0].args[1]).toMatchObject({ queue_name: CALENDAR_OPS_QUEUE });
  });

  it("patches the event with the interview's current time and panel", async () => {
    queueBatch(message("update"));
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    expect((await processCalendarOps(admin.client, provider)).done).toBe(1);
    const [call] = provider.callsOf("updateEvent");
    expect(call.args[1]).toMatchObject({ start: "2026-12-03T10:00:00.000Z", attendees: [{ email: "rita@example.test" }] });
  });

  it("drops an event that's already gone, an update for a closed interview, or a disconnected organizer", async () => {
    provider.deleteInGoogle(eventId);
    queueBatch(message("update", 1), message("update", 2), message("delete", 3));
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    admin.queueRpc("interview_event_details", { data: details({ status: "cancelled" }), error: null });
    admin.queueRpc("interview_event_details", { data: details({ organizer_connection_id: null }), error: null });
    expect(await processCalendarOps(admin.client, provider)).toMatchObject({ done: 0, dropped: 3 });
    expect(archived()).toEqual([1, 2, 3]);
  });

  it("leaves a failure in the queue to retry, and gives up at the last read", async () => {
    provider.fail("deleteEvent", new CalendarError("rate_limited", 429));
    provider.fail("deleteEvent", new CalendarError("error", 500));
    queueBatch(message("delete", 1, 1), message("delete", 2, CALENDAR_OPS_MAX_READS));
    admin.queueRpc("interview_event_details", { data: details({ status: "cancelled" }), error: null });
    admin.queueRpc("interview_event_details", { data: details({ status: "cancelled" }), error: null });
    const result = await processCalendarOps(admin.client, provider);
    expect(result).toMatchObject({ done: 0, retrying: 1 });
    expect(result.gaveUp).toEqual([`delete ${INTERVIEW}: Calendar error (500)`]);
    expect(archived()).toEqual([2]);
  });

  it("does nothing on an empty queue", async () => {
    queueBatch();
    expect(await processCalendarOps(admin.client, provider)).toEqual({ done: 0, dropped: 0, retrying: 0, gaveUp: [] });
  });
});
