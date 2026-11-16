import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { eventInputOf, loadEventDetails } from "@/helpers/calendar/events";
import { isCalendarError, type CalendarProvider, type Interval } from "@/helpers/calendar/provider";
import { computeSlots } from "@/helpers/calendar/slots";
import { withCalendarAuth } from "@/helpers/calendar/tokens";
import { loadPanelAvailability } from "./scheduling";
import { selfSchedulingMessage } from "./self-scheduling-copy";

// The candidate's side of a self-scheduling link (IVT-063, IV-REQ-021/022).
// Everything runs on the server with the service role: the token is checked
// in SQL (scheduling_link_context and the *_by_token RPCs), which only the
// service role may call. Google is called after the database change applied,
// on the organizer's calendar (the member who sent the link, D15).

type Admin = SupabaseClient<Database>;

export type SelfSchedulingDeps = { admin: Admin; provider: CalendarProvider };

/** What resolve_scheduling_token returns: the page's only view of the interview. */
export type PublicLink = {
  status: "awaiting_candidate" | "scheduled";
  job_title: string | null;
  company_name: string | null;
  interview_name: string;
  duration_minutes: number;
  interviewers: string[];
  starts_at: string | null;
  ends_at: string | null;
  time_zone: string | null;
  meeting_url: string | null;
  can_change: boolean;
  expires_at: string;
};

type LinkContext = {
  id: string;
  application_id: string;
  company_id: string;
  job_post_id: string;
  status: "awaiting_candidate" | "scheduled";
  duration_minutes: number;
  starts_at: string | null;
  organizer_user_id: string | null;
  panel: string[];
  cached_slots: Interval[] | null;
};

export type ChangeResult =
  | { ok: true; startsAt: string | null }
  | { ok: false; reason: string; error: string };

const fail = (reason: string): ChangeResult => ({ ok: false, reason, error: selfSchedulingMessage(reason) });

/**
 * A booking re-checks free/busy live. The slot list was computed up to 2
 * minutes earlier, so the 24-hour notice is checked with this much slack:
 * a candidate who took a while to pick isn't told the time was taken.
 */
const LIVE_CHECK_GRACE_MS = 2 * 60 * 60 * 1000;

/** The public view (anon client: resolve_scheduling_token is the one anon function). */
export async function resolveLink(publicClient: Admin, token: string): Promise<PublicLink | null> {
  const { data, error } = await publicClient.rpc("resolve_scheduling_token", { p_token: token });
  if (error) throw new Error(`Couldn't open the scheduling link: ${error.message}`);
  const link = data as ({ ok: boolean } & PublicLink) | null;
  if (!link?.ok) return null;
  const view: Partial<typeof link> = { ...link };
  delete view.ok;
  return view as PublicLink;
}

async function loadContext(admin: Admin, token: string): Promise<LinkContext | null> {
  const { data, error } = await admin.rpc("scheduling_link_context", { p_token: token });
  if (error) throw new Error(`Couldn't load the scheduling link: ${error.message}`);
  return (data as LinkContext | null) ?? null;
}

const toIso = (instant: string) => new Date(instant).toISOString();

/** The interview's own current time, which mustn't block moving it. */
function currentSlot(ctx: LinkContext): Interval | null {
  if (ctx.status !== "scheduled" || !ctx.starts_at) return null;
  const start = toIso(ctx.starts_at);
  return { start, end: new Date(Date.parse(start) + ctx.duration_minutes * 60_000).toISOString() };
}

/**
 * Open slots for the link's panel. Every member was connected when the link
 * went out (IV-REQ-012); if anyone's calendar can't be read now, no slots
 * are offered rather than risk a clash.
 */
async function computeLinkSlots(deps: SelfSchedulingDeps, ctx: LinkContext, now: Date): Promise<Interval[]> {
  const current = currentSlot(ctx);
  const loaded = await loadPanelAvailability(deps, { jobPostId: ctx.job_post_id, panel: ctx.panel, ignore: current }, now);
  if (loaded.some((m) => m.member.busy === null)) return [];
  const { slots } = computeSlots({ members: loaded.map((m) => m.member), now, durationMinutes: ctx.duration_minutes });
  return current ? slots.filter((s) => s.start !== current.start) : slots;
}

/**
 * The page's slots: from the 2-minute cache in the database when it's fresh
 * (scheduling_link_context applies the rule), otherwise computed and cached.
 * Null for a link that opens nothing.
 */
export async function linkSlots(deps: SelfSchedulingDeps, token: string, now = new Date()): Promise<Interval[] | null> {
  const ctx = await loadContext(deps.admin, token);
  if (!ctx) return null;
  if (ctx.cached_slots) return ctx.cached_slots;
  const slots = await computeLinkSlots(deps, ctx, now);
  const { error } = await deps.admin.rpc("save_scheduling_slots", { p_id: ctx.id, p_slots: slots as unknown as Json });
  if (error) reportError("[self-scheduling] couldn't cache the slots", ctx.id, error.code);
  return slots;
}

/** IV-REQ-021: the picked time is still free for the whole panel, checked live. */
async function stillOpen(deps: SelfSchedulingDeps, ctx: LinkContext, startsAt: string, now: Date): Promise<boolean> {
  const slots = await computeLinkSlots(deps, ctx, new Date(now.getTime() - LIVE_CHECK_GRACE_MS));
  const start = toIso(startsAt);
  return slots.some((s) => s.start === start);
}

/**
 * Books the link's interview at `startsAt`, then creates the event on the
 * organizer's calendar with a Meet link (attendees: the panel and the
 * candidate). If Google refuses, the booking is undone and the link works
 * again.
 */
export async function bookByToken(
  deps: SelfSchedulingDeps,
  token: string,
  { startsAt, timeZone }: { startsAt: string; timeZone?: string | null },
  now = new Date(),
): Promise<ChangeResult> {
  const ctx = await loadContext(deps.admin, token);
  if (!ctx) return fail("not_found");
  if (ctx.status !== "awaiting_candidate") return fail("already_booked");
  if (!(await stillOpen(deps, ctx, startsAt, now))) return fail("slot_taken");

  const { data, error } = await deps.admin.rpc("book_by_token", {
    p_token: token,
    p_starts_at: toIso(startsAt),
    ...(timeZone ? { p_time_zone: timeZone } : {}),
  });
  if (error) throw new Error(`Couldn't book: ${error.message}`);
  const booked = data as { ok: boolean; reason?: string; starts_at?: string } | null;
  if (!booked?.ok) return fail(booked?.reason ?? "error");

  try {
    const details = await loadEventDetails(deps.admin, ctx.id);
    if (!details?.organizer_connection_id) throw new Error("organizer not connected");
    const created = await withCalendarAuth(deps.admin, details.organizer_connection_id, (accessToken) =>
      deps.provider.createEvent(accessToken, eventInputOf(details)),
    );
    const { error: saveError } = await deps.admin
      .from("scheduled_interviews")
      .update({ provider_event_id: created.eventId, meeting_url: created.meetingUrl, updated_at: new Date().toISOString() })
      .eq("id", ctx.id)
      .eq("status", "scheduled");
    if (saveError) reportError("[self-scheduling] couldn't store the event id", ctx.id, saveError.code);
  } catch (err) {
    reportError("[self-scheduling] Google refused the booking", ctx.id, isCalendarError(err) ? err.code : "error");
    await deps.admin.rpc("return_interview_to_link", { p_id: ctx.id, p_reason: "calendar_failed" });
    return fail("calendar_failed");
  }
  return { ok: true, startsAt: booked.starts_at ?? toIso(startsAt) };
}

/**
 * IV-REQ-022: moves a booked interview (until 4 hours before it). The event
 * on the organizer's calendar is patched; if Google can't be reached, the
 * patch is queued for the calendar ops worker. An organizer who disconnected
 * can't have their event moved, so the candidate is asked to reply to the
 * invite instead.
 */
export async function rescheduleByToken(
  deps: SelfSchedulingDeps,
  token: string,
  { startsAt }: { startsAt: string },
  now = new Date(),
): Promise<ChangeResult> {
  const ctx = await loadContext(deps.admin, token);
  if (!ctx) return fail("not_found");
  if (ctx.status !== "scheduled") return fail("not_booked");
  const details = await loadEventDetails(deps.admin, ctx.id);
  if (!details?.organizer_connection_id || !details.provider_event_id) return fail("cant_change");
  if (!(await stillOpen(deps, ctx, startsAt, now))) return fail("slot_taken");

  const { data, error } = await deps.admin.rpc("reschedule_by_token", { p_token: token, p_starts_at: toIso(startsAt) });
  if (error) throw new Error(`Couldn't reschedule: ${error.message}`);
  const moved = data as { ok: boolean; reason?: string; starts_at?: string; ends_at?: string } | null;
  if (!moved?.ok || !moved.starts_at || !moved.ends_at) return fail(moved?.reason ?? "error");

  try {
    await withCalendarAuth(deps.admin, details.organizer_connection_id, (accessToken) =>
      deps.provider.updateEvent(accessToken, details.provider_event_id!, {
        start: moved.starts_at!,
        end: moved.ends_at!,
        timeZone: details.time_zone,
      }),
    );
  } catch (err) {
    reportError("[self-scheduling] couldn't move the event; queued", ctx.id, isCalendarError(err) ? err.code : "error");
    await deps.admin.rpc("queue_interview_calendar_op", { p_interview_id: ctx.id, p_op: "update" });
  }
  return { ok: true, startsAt: moved.starts_at };
}

/**
 * IV-REQ-022: cancels a booked interview (until 4 hours before it). It goes
 * back to waiting for the candidate, so the same link books again. The event
 * is deleted; a failed delete is queued with its id, since the row no longer
 * holds it.
 */
export async function cancelByToken(deps: SelfSchedulingDeps, token: string): Promise<ChangeResult> {
  const { data, error } = await deps.admin.rpc("cancel_by_token", { p_token: token });
  if (error) throw new Error(`Couldn't cancel: ${error.message}`);
  const cancelled = data as { ok: boolean; reason?: string; id?: string; provider_event_id?: string | null } | null;
  if (!cancelled?.ok || !cancelled.id) return fail(cancelled?.reason ?? "error");

  const eventId = cancelled.provider_event_id;
  if (eventId) {
    const details = await loadEventDetails(deps.admin, cancelled.id);
    const queueDelete = () =>
      deps.admin.rpc("queue_interview_calendar_op", { p_interview_id: cancelled.id!, p_op: "delete", p_event_id: eventId });
    if (!details?.organizer_connection_id) {
      reportError("[self-scheduling] the organizer is disconnected; event left", cancelled.id);
    } else {
      try {
        await withCalendarAuth(deps.admin, details.organizer_connection_id, (accessToken) =>
          deps.provider.deleteEvent(accessToken, eventId),
        );
      } catch (err) {
        reportError("[self-scheduling] couldn't delete the event; queued", cancelled.id, isCalendarError(err) ? err.code : "error");
        await queueDelete();
      }
    }
  }
  return { ok: true, startsAt: null };
}
