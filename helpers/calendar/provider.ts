// The calendar provider interface (spec §4 "Using it", D3). Google is the
// only implementation in v1 (helpers/calendar/google.ts); tests use
// FakeCalendarProvider (test/utils/calendar.ts). Every call takes the access
// token of the member it acts for (helpers/calendar/tokens.ts).

/** A busy block or a slot, as ISO instants. */
export type Interval = { start: string; end: string };

export type EventAttendee = { email: string; displayName?: string | null };

export type EventInput = {
  /** Our scheduled_interviews.id: the Meet request id and a private extended property. */
  interviewId: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  attendees: EventAttendee[];
};

export type EventPatch = Partial<Pick<EventInput, "summary" | "description" | "start" | "end" | "timeZone" | "attendees">>;

export type AttendeeResponse = "needs_action" | "accepted" | "declined" | "tentative";

export type CalendarEvent = {
  id: string;
  start: string;
  end: string;
  meetingUrl: string | null;
  attendees: { email: string; response: AttendeeResponse }[];
};

export type CreatedEvent = { eventId: string; meetingUrl: string | null };

/**
 * `unauthorized`: the access token was refused (retry once after a refresh).
 * `invalid_grant`: the refresh token is dead; the member must reconnect.
 * `not_found`: the event is gone (404/410).
 */
export type CalendarErrorCode = "unauthorized" | "invalid_grant" | "not_found" | "forbidden" | "rate_limited" | "error";

/** Carries Google's status and error code only, never a response body or a token. */
export class CalendarError extends Error {
  constructor(
    readonly code: CalendarErrorCode,
    readonly status: number | null = null,
    readonly reason: string | null = null,
  ) {
    super(`Calendar ${code}${status ? ` (${status})` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "CalendarError";
  }
}

export const isCalendarError = (err: unknown, code?: CalendarErrorCode): err is CalendarError =>
  err instanceof CalendarError && (code === undefined || err.code === code);

export interface CalendarProvider {
  /** The token owner's busy blocks on their primary calendar. Titles and details are never read (IV-SEC-002). */
  freeBusy(accessToken: string, window: Interval): Promise<Interval[]>;
  /** An event on the token owner's primary calendar with a Meet link; attendees are emailed. */
  createEvent(accessToken: string, input: EventInput): Promise<CreatedEvent>;
  /** Moves or changes the event; attendees are emailed. A gone event throws `not_found`. */
  updateEvent(accessToken: string, eventId: string, patch: EventPatch): Promise<void>;
  /** Deletes the event; attendees are emailed. An event that's already gone is fine. */
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
  /** The event, or null when it was deleted. */
  getEvent(accessToken: string, eventId: string): Promise<CalendarEvent | null>;
  /** Revokes a refresh (or access) token. */
  revoke(token: string): Promise<void>;
}
