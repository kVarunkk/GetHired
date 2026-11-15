import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCalendarProvider } from "@/test/utils/calendar";
import { googleCalendar, GOOGLE_CALENDAR_API, GOOGLE_REVOKE_URL } from "./google";
import { CalendarError, isCalendarError, type CalendarProvider, type EventInput } from "./provider";

const TOKEN = "ya29.test-access-token";

const input: EventInput = {
  interviewId: "f1000000-0000-4000-8000-000000000001",
  summary: "Technical screen: Ada Lovelace",
  description: "Interview kit: https://gethired.devhub.co.in/company/interviews/f1",
  start: "2026-12-01T10:00:00.000Z",
  end: "2026-12-01T10:45:00.000Z",
  timeZone: "Europe/London",
  attendees: [{ email: "rita@acme.test", displayName: "Rita" }, { email: "ada@example.test" }],
};

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let recorded: Recorded[];

function stubFetch(handler: (r: Recorded) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
      const raw = init.body as string | undefined;
      let body: unknown = raw;
      try {
        body = raw && headers["Content-Type"] === "application/json" ? JSON.parse(raw) : raw;
      } catch {
        /* form body */
      }
      const r = { url, method: init.method ?? "GET", headers, body };
      recorded.push(r);
      return handler(r);
    }),
  );
}

beforeEach(() => {
  recorded = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("googleCalendar requests (IVT-040)", () => {
  it("queries free/busy for the token owner's primary calendar only", async () => {
    stubFetch(() =>
      json(200, {
        calendars: { primary: { busy: [{ start: "2026-12-01T09:00:00Z", end: "2026-12-01T10:00:00Z" }] } },
      }),
    );
    const busy = await googleCalendar.freeBusy(TOKEN, { start: "2026-12-01T00:00:00Z", end: "2026-12-15T00:00:00Z" });
    expect(busy).toEqual([{ start: "2026-12-01T09:00:00.000Z", end: "2026-12-01T10:00:00.000Z" }]);
    expect(recorded[0]).toMatchObject({
      url: `${GOOGLE_CALENDAR_API}/freeBusy`,
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: { timeMin: "2026-12-01T00:00:00Z", timeMax: "2026-12-15T00:00:00Z", items: [{ id: "primary" }] },
    });
  });

  it("creates the event with a Meet link, sendUpdates=all and the guest restrictions (IV-SEC-003)", async () => {
    stubFetch(() => json(200, { id: "evt1", hangoutLink: "https://meet.google.com/abc-defg-hij" }));
    const created = await googleCalendar.createEvent(TOKEN, input);
    expect(created).toEqual({ eventId: "evt1", meetingUrl: "https://meet.google.com/abc-defg-hij" });
    const [r] = recorded;
    expect(r.method).toBe("POST");
    const url = new URL(r.url);
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(r.body).toEqual({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: "Europe/London" },
      end: { dateTime: input.end, timeZone: "Europe/London" },
      attendees: [{ email: "rita@acme.test", displayName: "Rita" }, { email: "ada@example.test" }],
      conferenceData: {
        createRequest: { requestId: input.interviewId, conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      extendedProperties: { private: { gethired_interview_id: input.interviewId } },
    });
  });

  it("reads the Meet link from the conference entry points when there's no hangoutLink", async () => {
    stubFetch(() =>
      json(200, {
        id: "evt2",
        conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://meet.google.com/x" }] },
      }),
    );
    expect((await googleCalendar.createEvent(TOKEN, input)).meetingUrl).toBe("https://meet.google.com/x");
  });

  it("patches and deletes with sendUpdates=all", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await googleCalendar.updateEvent(TOKEN, "evt/1", { start: input.start, end: input.end, timeZone: "UTC" });
    await googleCalendar.deleteEvent(TOKEN, "evt/1");
    expect(recorded.map((r) => [r.method, r.url])).toEqual([
      ["PATCH", `${GOOGLE_CALENDAR_API}/calendars/primary/events/evt%2F1?sendUpdates=all`],
      ["DELETE", `${GOOGLE_CALENDAR_API}/calendars/primary/events/evt%2F1?sendUpdates=all`],
    ]);
    expect(recorded[0].body).toEqual({
      start: { dateTime: input.start, timeZone: "UTC" },
      end: { dateTime: input.end, timeZone: "UTC" },
    });
  });

  it("maps an event's attendees' responses", async () => {
    stubFetch(() =>
      json(200, {
        id: "evt1",
        status: "confirmed",
        start: { dateTime: "2026-12-01T11:00:00+01:00" },
        end: { dateTime: "2026-12-01T11:45:00+01:00" },
        hangoutLink: "https://meet.google.com/a",
        attendees: [
          { email: "Rita@Acme.test", responseStatus: "declined" },
          { email: "ada@example.test", responseStatus: "needsAction" },
        ],
      }),
    );
    expect(await googleCalendar.getEvent(TOKEN, "evt1")).toEqual({
      id: "evt1",
      start: "2026-12-01T10:00:00.000Z",
      end: "2026-12-01T10:45:00.000Z",
      meetingUrl: "https://meet.google.com/a",
      attendees: [
        { email: "rita@acme.test", response: "declined" },
        { email: "ada@example.test", response: "needs_action" },
      ],
    });
  });

  it("treats a cancelled, 404 or 410 event as deleted", async () => {
    stubFetch(() => json(200, { id: "evt1", status: "cancelled" }));
    expect(await googleCalendar.getEvent(TOKEN, "evt1")).toBeNull();
    for (const status of [404, 410]) {
      stubFetch(() => json(status, { error: { errors: [{ reason: "notFound" }] } }));
      expect(await googleCalendar.getEvent(TOKEN, "evt1")).toBeNull();
      await expect(googleCalendar.deleteEvent(TOKEN, "evt1")).resolves.toBeUndefined();
      await expect(googleCalendar.updateEvent(TOKEN, "evt1", { summary: "x" })).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it.each([
    [401, { error: { errors: [{ reason: "authError" }] } }, "unauthorized"],
    [400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }, "invalid_grant"],
    [429, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "rate_limited"],
    [403, { error: { errors: [{ reason: "forbidden" }] } }, "forbidden"],
    [500, { error: { errors: [{ reason: "backendError" }] } }, "error"],
  ])("maps a %s to %s, without the body in the message", async (status, body, code) => {
    stubFetch(() => json(status, body));
    const err = await googleCalendar.freeBusy(TOKEN, { start: "a", end: "b" }).catch((e: unknown) => e);
    expect(isCalendarError(err, code as CalendarError["code"])).toBe(true);
    expect((err as Error).message).not.toContain("expired or revoked");
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("revokes at Google and treats an already-dead token as revoked", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    await googleCalendar.revoke("1//refresh");
    expect(recorded[0]).toMatchObject({ url: GOOGLE_REVOKE_URL, method: "POST", body: "token=1%2F%2Frefresh" });

    stubFetch(() => json(400, { error: "invalid_token" }));
    await expect(googleCalendar.revoke("1//refresh")).resolves.toBeUndefined();

    stubFetch(() => json(503, { error: "unavailable" }));
    await expect(googleCalendar.revoke("1//refresh")).rejects.toBeInstanceOf(CalendarError);
  });
});

// A tiny Google, enough for the shared contract below.
function fakeGoogleServer() {
  const events = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return (r: Recorded): Response => {
    const url = new URL(r.url);
    const match = /\/calendars\/primary\/events(?:\/([^/?]+))?$/.exec(url.pathname);
    if (url.pathname.endsWith("/freeBusy")) {
      const busy = [...events.values()].map((e) => ({
        start: (e.start as { dateTime: string }).dateTime,
        end: (e.end as { dateTime: string }).dateTime,
      }));
      return json(200, { calendars: { primary: { busy } } });
    }
    if (!match) return json(404, {});
    const id = match[1] ? decodeURIComponent(match[1]) : null;
    if (r.method === "POST") {
      const eventId = `g${++seq}`;
      events.set(eventId, { ...(r.body as object), id: eventId, hangoutLink: `https://meet.google.com/g${seq}` });
      return json(200, events.get(eventId));
    }
    const event = id ? events.get(id) : undefined;
    if (!event) return json(404, { error: { errors: [{ reason: "notFound" }] } });
    if (r.method === "DELETE") {
      events.delete(id!);
      return new Response(null, { status: 204 });
    }
    if (r.method === "PATCH") {
      Object.assign(event, r.body);
      return json(200, event);
    }
    return json(200, { ...event, status: "confirmed" });
  };
}

function contract(name: string, setup: () => CalendarProvider) {
  describe(`CalendarProvider contract: ${name}`, () => {
    it("creates, reads, moves and deletes an event, and the event shows as busy", async () => {
      const provider = setup();
      const { eventId, meetingUrl } = await provider.createEvent(TOKEN, input);
      expect(meetingUrl).toMatch(/^https:\/\/meet\.google\.com\//);

      const read = await provider.getEvent(TOKEN, eventId);
      expect(read).toMatchObject({ id: eventId, start: input.start, end: input.end });
      expect(read?.attendees.map((a) => a.email)).toEqual(["rita@acme.test", "ada@example.test"]);

      const busy = await provider.freeBusy(TOKEN, { start: "2026-12-01T00:00:00.000Z", end: "2026-12-02T00:00:00.000Z" });
      expect(busy.map((b) => new Date(b.start).toISOString())).toContain(input.start);

      await provider.updateEvent(TOKEN, eventId, {
        start: "2026-12-02T10:00:00.000Z",
        end: "2026-12-02T10:45:00.000Z",
        timeZone: "UTC",
      });
      expect((await provider.getEvent(TOKEN, eventId))?.start).toBe("2026-12-02T10:00:00.000Z");

      await provider.deleteEvent(TOKEN, eventId);
      expect(await provider.getEvent(TOKEN, eventId)).toBeNull();
      await expect(provider.deleteEvent(TOKEN, eventId)).resolves.toBeUndefined();
      await expect(provider.updateEvent(TOKEN, eventId, { summary: "x" })).rejects.toMatchObject({ code: "not_found" });
    });

    it("revokes", async () => {
      await expect(setup().revoke("1//refresh")).resolves.toBeUndefined();
    });
  });
}

contract("google over a stubbed fetch", () => {
  const server = fakeGoogleServer();
  stubFetch((r) => (r.url === GOOGLE_REVOKE_URL ? new Response(null, { status: 200 }) : server(r)));
  return googleCalendar;
});
contract("FakeCalendarProvider", () => new FakeCalendarProvider());
