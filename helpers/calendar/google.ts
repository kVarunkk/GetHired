import "server-only";
import {
  CalendarError,
  type AttendeeResponse,
  type CalendarEvent,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type EventPatch,
  type Interval,
} from "./provider";

// Google Calendar over REST (spec §4 "Using it"), not the googleapis package.
// Scopes: calendar.freebusy and calendar.events only (IV-SEC-002).

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

type GoogleEvent = {
  id: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
};

/** Google's error reason (`invalid_grant`, `rateLimitExceeded`), never the body. */
async function reasonOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as {
      error?: string | { errors?: { reason?: string }[]; status?: string };
    };
    if (typeof body.error === "string") return body.error.slice(0, 60);
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status;
    return typeof reason === "string" ? reason.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export async function calendarErrorOf(res: Response): Promise<CalendarError> {
  const reason = await reasonOf(res);
  if (reason === "invalid_grant") return new CalendarError("invalid_grant", res.status, reason);
  if (res.status === 401) return new CalendarError("unauthorized", 401, reason);
  if (res.status === 404 || res.status === 410) return new CalendarError("not_found", res.status, reason);
  if (res.status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
    return new CalendarError("rate_limited", res.status, reason);
  }
  if (res.status === 403) return new CalendarError("forbidden", 403, reason);
  return new CalendarError("error", res.status, reason);
}

async function call(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new CalendarError("error", null, "network");
  }
  if (!res.ok) throw await calendarErrorOf(res);
  return res;
}

const RESPONSES: Record<string, AttendeeResponse> = {
  needsAction: "needs_action",
  accepted: "accepted",
  declined: "declined",
  tentative: "tentative",
};

function meetingUrlOf(event: GoogleEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
}

function toEvent(event: GoogleEvent): CalendarEvent {
  return {
    id: event.id,
    start: new Date(event.start?.dateTime ?? event.start?.date ?? 0).toISOString(),
    end: new Date(event.end?.dateTime ?? event.end?.date ?? 0).toISOString(),
    meetingUrl: meetingUrlOf(event),
    attendees: (event.attendees ?? [])
      .filter((a): a is { email: string; responseStatus?: string } => typeof a.email === "string")
      .map((a) => ({ email: a.email.toLowerCase(), response: RESPONSES[a.responseStatus ?? ""] ?? "needs_action" })),
  };
}

function eventBody(input: EventPatch) {
  return {
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.start !== undefined ? { start: { dateTime: input.start, timeZone: input.timeZone } } : {}),
    ...(input.end !== undefined ? { end: { dateTime: input.end, timeZone: input.timeZone } } : {}),
    ...(input.attendees !== undefined
      ? {
          attendees: input.attendees.map((a) => ({
            email: a.email,
            ...(a.displayName ? { displayName: a.displayName } : {}),
          })),
        }
      : {}),
  };
}

const eventPath = (eventId: string) => `/calendars/primary/events/${encodeURIComponent(eventId)}`;

export const googleCalendar: CalendarProvider = {
  async freeBusy(accessToken: string, window: Interval): Promise<Interval[]> {
    const res = await call(accessToken, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: window.start, timeMax: window.end, items: [{ id: "primary" }] }),
    });
    const body = (await res.json()) as {
      calendars?: Record<string, { busy?: Interval[]; errors?: { reason?: string }[] }>;
    };
    const primary = body.calendars?.primary;
    if (!primary || (primary.errors && primary.errors.length > 0)) {
      throw new CalendarError("error", null, primary?.errors?.[0]?.reason ?? "no_calendar");
    }
    return (primary.busy ?? []).map((b) => ({
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString(),
    }));
  },

  async createEvent(accessToken: string, input: EventInput): Promise<CreatedEvent> {
    const res = await call(accessToken, "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
      method: "POST",
      body: JSON.stringify({
        ...eventBody(input),
        conferenceData: {
          createRequest: { requestId: input.interviewId, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
        // IV-SEC-003: the candidate doesn't see the panel's addresses.
        guestsCanSeeOtherGuests: false,
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        extendedProperties: { private: { gethired_interview_id: input.interviewId } },
      }),
    });
    const event = (await res.json()) as GoogleEvent;
    return { eventId: event.id, meetingUrl: meetingUrlOf(event) };
  },

  async updateEvent(accessToken: string, eventId: string, patch: EventPatch): Promise<void> {
    await call(accessToken, `${eventPath(eventId)}?sendUpdates=all`, {
      method: "PATCH",
      body: JSON.stringify(eventBody(patch)),
    });
  },

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    try {
      await call(accessToken, `${eventPath(eventId)}?sendUpdates=all`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof CalendarError && err.code === "not_found") return;
      throw err;
    }
  },

  async getEvent(accessToken: string, eventId: string): Promise<CalendarEvent | null> {
    try {
      const res = await call(accessToken, eventPath(eventId));
      const event = (await res.json()) as GoogleEvent;
      return event.status === "cancelled" ? null : toEvent(event);
    } catch (err) {
      if (err instanceof CalendarError && err.code === "not_found") return null;
      throw err;
    }
  },

  async revoke(token: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
        cache: "no-store",
      });
    } catch {
      throw new CalendarError("error", null, "network");
    }
    // 400 invalid_token: already revoked or expired, which is what we wanted.
    if (res.ok) return;
    const reason = await reasonOf(res);
    if (res.status === 400 && (reason === "invalid_token" || reason === "invalid_grant")) return;
    throw new CalendarError("error", res.status, reason);
  },
};
