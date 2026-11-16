import {
  CalendarError,
  type CalendarEvent,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type EventPatch,
  type Interval,
} from "@/helpers/calendar/provider";

// IVT-040: an in-memory CalendarProvider for tests. Each access token is one
// member's primary calendar. Never calls the network.

type StoredEvent = CalendarEvent & { input: EventInput; deleted: boolean; owner: string };

export type FakeCall = { method: keyof CalendarProvider; token: string; args: unknown[] };

export class FakeCalendarProvider implements CalendarProvider {
  /** Busy blocks per token. A token missing here has an empty calendar. */
  readonly busy = new Map<string, Interval[]>();
  readonly events = new Map<string, StoredEvent>();
  readonly revoked: string[] = [];
  readonly calls: FakeCall[] = [];
  private failures = new Map<string, CalendarError[]>();
  private seq = 0;

  /** The next calls of `method` (for `token`, or any token) throw these errors, in order. */
  fail(method: keyof CalendarProvider, error: CalendarError, token = "*"): this {
    const key = `${method}:${token}`;
    this.failures.set(key, [...(this.failures.get(key) ?? []), error]);
    return this;
  }

  setBusy(token: string, busy: Interval[]): this {
    this.busy.set(token, busy);
    return this;
  }

  /** Simulates a change made in Google Calendar itself. */
  moveInGoogle(eventId: string, start: string, end: string) {
    const e = this.events.get(eventId);
    if (e) Object.assign(e, { start, end });
  }

  deleteInGoogle(eventId: string) {
    const e = this.events.get(eventId);
    if (e) e.deleted = true;
  }

  respond(eventId: string, email: string, response: CalendarEvent["attendees"][number]["response"]) {
    const e = this.events.get(eventId);
    const a = e?.attendees.find((x) => x.email === email.toLowerCase());
    if (a) a.response = response;
  }

  callsOf(method: keyof CalendarProvider): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  private enter(method: keyof CalendarProvider, token: string, args: unknown[]) {
    this.calls.push({ method, token, args });
    for (const key of [`${method}:${token}`, `${method}:*`]) {
      const queue = this.failures.get(key);
      if (queue && queue.length > 0) throw queue.shift();
    }
  }

  private live(token: string, eventId: string): StoredEvent {
    const e = this.events.get(eventId);
    if (!e || e.deleted || e.owner !== token) throw new CalendarError("not_found", 404);
    return e;
  }

  async freeBusy(token: string, window: Interval): Promise<Interval[]> {
    this.enter("freeBusy", token, [window]);
    const from = Date.parse(window.start);
    const to = Date.parse(window.end);
    const own = [...this.events.values()]
      .filter((e) => !e.deleted && e.owner === token)
      .map((e) => ({ start: e.start, end: e.end }));
    return [...(this.busy.get(token) ?? []), ...own].filter((b) => Date.parse(b.end) > from && Date.parse(b.start) < to);
  }

  async createEvent(token: string, input: EventInput): Promise<CreatedEvent> {
    this.enter("createEvent", token, [input]);
    const id = `evt_${++this.seq}`;
    const meetingUrl = `https://meet.google.com/fak-e${this.seq}`;
    this.events.set(id, {
      id,
      start: new Date(input.start).toISOString(),
      end: new Date(input.end).toISOString(),
      meetingUrl,
      attendees: input.attendees.map((a) => ({ email: a.email.toLowerCase(), response: "needs_action" })),
      input,
      deleted: false,
      owner: token,
    });
    return { eventId: id, meetingUrl };
  }

  async updateEvent(token: string, eventId: string, patch: EventPatch): Promise<void> {
    this.enter("updateEvent", token, [eventId, patch]);
    const e = this.live(token, eventId);
    if (patch.start) e.start = new Date(patch.start).toISOString();
    if (patch.end) e.end = new Date(patch.end).toISOString();
    if (patch.attendees) {
      e.attendees = patch.attendees.map((a) => ({
        email: a.email.toLowerCase(),
        response: e.attendees.find((x) => x.email === a.email.toLowerCase())?.response ?? "needs_action",
      }));
    }
    e.input = { ...e.input, ...patch };
  }

  async deleteEvent(token: string, eventId: string): Promise<void> {
    this.enter("deleteEvent", token, [eventId]);
    const e = this.events.get(eventId);
    if (e && e.owner === token) e.deleted = true;
  }

  async getEvent(token: string, eventId: string): Promise<CalendarEvent | null> {
    this.enter("getEvent", token, [eventId]);
    const e = this.events.get(eventId);
    if (!e || e.deleted || e.owner !== token) return null;
    return { id: e.id, start: e.start, end: e.end, meetingUrl: e.meetingUrl, attendees: e.attendees.map((a) => ({ ...a })) };
  }

  async revoke(token: string): Promise<void> {
    this.enter("revoke", token, []);
    this.revoked.push(token);
  }
}
