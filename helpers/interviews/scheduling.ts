import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { DEFAULT_WORKING_HOURS, HORIZON_DAYS, type WorkingHours } from "@/helpers/calendar/config";
import { schedulingMessage } from "@/helpers/calendar/copy";
import { eventInputOf, loadEventDetails, attendeesOf, type EventDetails } from "@/helpers/calendar/events";
import { isCalendarError, type CalendarProvider, type Interval } from "@/helpers/calendar/provider";
import { computeSlots, type SlotMember } from "@/helpers/calendar/slots";
import { workingHoursSchema } from "@/helpers/calendar/availability-schema";
import { withCalendarAuth } from "@/helpers/calendar/tokens";
import { interviewMessage } from "./copy";
import { bookInterviewSchema, findSlotsSchema, type BookInterviewInput, type FindSlotsInput } from "./scheduling-schema";

// Phase 2 scheduling through Google Calendar (IVT-042–044). `supabase` is the
// session member's RLS client: the RPCs check scheduling.manage. `admin` is
// the service role, for tokens, other members' availability and the event
// details. Google is called only after the database change applied
// (IV-SEC-006).

type Db = SupabaseClient<Database>;

/** The service role and the calendar provider: what reading the panel's calendars needs. */
export type CalendarDeps = { admin: Db; provider: CalendarProvider };

export type SchedulingDeps = CalendarDeps & { supabase: Db; userId: string };

export type MemberCalendarStatus = "connected" | "unknown" | "error";

export type PanelMemberCalendar = { userId: string; status: MemberCalendarStatus; availabilityKnown: boolean };

export type FindSlotsResult =
  | { ok: true; slots: Interval[]; members: PanelMemberCalendar[] }
  | { ok: false; error: string; reason: string };

const fail = (reason: string, error = schedulingMessage(reason)) => ({ ok: false as const, error, reason });

async function ownConnectionStatus(deps: SchedulingDeps): Promise<"active" | "error" | null> {
  const { data } = await deps.supabase
    .from("calendar_connections")
    .select("status")
    .eq("user_id", deps.userId)
    .eq("provider", "google")
    .maybeSingle();
  return data ? (data.status === "error" ? "error" : "active") : null;
}

/**
 * IVT-042 (IV-REQ-012, IV-REQ-020): the open slots for a panel over the next
 * 14 days. One free/busy query per connected member with their own token; a
 * member whose calendar can't be read shows as "availability unknown" and
 * doesn't block the search.
 */
export async function findInterviewSlots(
  deps: SchedulingDeps,
  input: FindSlotsInput,
  now = new Date(),
): Promise<FindSlotsResult> {
  const parsed = findSlotsSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0].message);
  const { jobPostId, panel, durationMinutes } = parsed.data;

  const { data: statuses, error } = await deps.supabase.rpc("panel_calendar_status", {
    p_job_post_id: jobPostId,
    p_user_ids: panel,
  });
  if (error) throw new Error(`Couldn't load the panel's calendars: ${error.message}`);
  // Empty without scheduling.manage for the job.
  if (!statuses?.length) return fail("forbidden", interviewMessage("forbidden"));
  if (statuses.length !== panel.length) return fail("invalid_panel", interviewMessage("invalid_panel"));

  const own = await ownConnectionStatus(deps);
  if (own !== "active") return fail(own === "error" ? "organizer_reconnect" : "not_connected");

  const statusOf = new Map(statuses.map((s) => [s.user_id, s.status as MemberCalendarStatus]));
  const loaded = await loadPanelAvailability(deps, { jobPostId, panel }, now);
  const members = loaded.map(({ member, failure }) => {
    const status: MemberCalendarStatus =
      failure === "invalid_grant" ? "error" : failure ? "unknown" : (statusOf.get(member.userId) ?? "unknown");
    return {
      userId: member.userId,
      status: member.busy ? "connected" : status === "connected" ? "unknown" : status,
      availabilityKnown: member.busy !== null,
    } satisfies PanelMemberCalendar;
  });

  const { slots } = computeSlots({ members: loaded.map((m) => m.member), now, durationMinutes });
  return { ok: true, slots, members };
}

export type PanelAvailability = { member: SlotMember; failure: "invalid_grant" | "error" | null };

/**
 * Each panel member's working hours (their own zone, else the company's) and
 * busy blocks over the slot window: one free/busy query per connected member
 * with their own token (difference 21). A member without a connection, or
 * whose query fails, has `busy: null` ("availability unknown"). `ignore` is
 * cut out of every busy block: a candidate moving their own interview isn't
 * blocked by its current time.
 */
export async function loadPanelAvailability(
  deps: CalendarDeps,
  { jobPostId, panel, ignore }: { jobPostId: string; panel: string[]; ignore?: Interval | null },
  now: Date,
): Promise<PanelAvailability[]> {
  const [{ data: job }, { data: connections }, { data: availability }] = await Promise.all([
    deps.admin.from("job_postings").select("company_id, company_info(time_zone)").eq("id", jobPostId).single(),
    deps.admin
      .from("calendar_connections")
      .select("id, user_id")
      .in("user_id", panel)
      .eq("provider", "google")
      .eq("status", "active"),
    deps.admin.from("member_availability").select("user_id, company_id, time_zone, working_hours").in("user_id", panel),
  ]);
  const companyId = job?.company_id;
  const companyZone = (job?.company_info as { time_zone: string | null } | null)?.time_zone ?? "UTC";
  const connectionOf = new Map((connections ?? []).map((c) => [c.user_id, c.id]));
  const hoursOf = new Map(
    (availability ?? []).filter((a) => a.company_id === companyId).map((a) => [a.user_id, a]),
  );
  const window = { start: now.toISOString(), end: new Date(now.getTime() + (HORIZON_DAYS + 1) * 86_400_000).toISOString() };

  return Promise.all(
    panel.map(async (userId): Promise<PanelAvailability> => {
      const saved = hoursOf.get(userId);
      const hours = saved ? workingHoursSchema.safeParse(saved.working_hours) : null;
      const connectionId = connectionOf.get(userId);
      let busy: Interval[] | null = null;
      let failure: PanelAvailability["failure"] = null;
      if (connectionId) {
        try {
          busy = await withCalendarAuth(deps.admin, connectionId, (token) => deps.provider.freeBusy(token, window));
          if (ignore) busy = withoutInterval(busy, ignore);
        } catch (err) {
          failure = isCalendarError(err, "invalid_grant") ? "invalid_grant" : "error";
          reportError("[scheduling] free/busy failed", userId, isCalendarError(err) ? err.code : "error");
        }
      }
      return {
        member: {
          userId,
          timeZone: saved?.time_zone ?? companyZone,
          workingHours: (hours?.success ? hours.data : DEFAULT_WORKING_HOURS) as WorkingHours,
          busy,
        },
        failure,
      };
    }),
  );
}

/** `busy` with `cut` removed: a block that overlaps it keeps only what lies outside. */
export function withoutInterval(busy: Interval[], cut: Interval): Interval[] {
  const cs = Date.parse(cut.start);
  const ce = Date.parse(cut.end);
  return busy.flatMap(({ start, end }) => {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (e <= cs || s >= ce) return [{ start, end }];
    const parts: Interval[] = [];
    if (s < cs) parts.push({ start, end: cut.start });
    if (e > ce) parts.push({ start: cut.end, end });
    return parts;
  });
}

export type BookResult =
  | { ok: true; id: string; applicationId: string; candidateInvited: boolean; meetingUrl: string | null }
  | { ok: false; error: string; reason: string };

/**
 * IVT-043 (IV-REQ-020 "Book", D15, D20): `book_interview` creates the row,
 * then the event goes on the booking member's calendar with a Meet link, the
 * panel and (unless D20 says no) the candidate as attendees. If Google
 * refuses, the row is cancelled so no `scheduled` interview is left without
 * an event.
 */
export async function bookInterview(deps: SchedulingDeps, input: BookInterviewInput): Promise<BookResult> {
  const parsed = bookInterviewSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0].message);
  const v = parsed.data;

  const { data: own } = await deps.supabase
    .from("member_availability")
    .select("time_zone")
    .eq("user_id", deps.userId)
    .maybeSingle();

  const { data, error } = await deps.supabase.rpc("book_interview", {
    p_application_id: v.applicationId,
    p_panel: v.panel,
    p_starts_at: v.startsAt,
    ...(v.planItemId
      ? { p_plan_item_id: v.planItemId }
      : { p_name: v.name ?? undefined, p_duration_minutes: v.durationMinutes ?? undefined }),
    ...(own?.time_zone ? { p_time_zone: own.time_zone } : {}),
  });
  if (error) throw new Error(`Couldn't book the interview: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; id?: string; application_id?: string } | null;
  if (!result?.ok || !result.id) {
    const reason = result?.reason ?? "error";
    return fail(reason, reason === "not_connected" ? schedulingMessage(reason) : interviewMessage(reason));
  }

  const details = await loadEventDetails(deps.admin, result.id);
  try {
    if (!details?.organizer_connection_id) throw new Error("organizer not connected");
    const created = await withCalendarAuth(deps.admin, details.organizer_connection_id, (token) =>
      deps.provider.createEvent(token, eventInputOf(details)),
    );
    const { error: saveError } = await deps.admin
      .from("scheduled_interviews")
      .update({ provider_event_id: created.eventId, meeting_url: created.meetingUrl, updated_at: new Date().toISOString() })
      .eq("id", result.id)
      .eq("status", "scheduled");
    if (saveError) reportError("[scheduling] couldn't store the event id", result.id, saveError.code);
    return {
      ok: true,
      id: result.id,
      applicationId: result.application_id ?? details.application_id,
      candidateInvited: Boolean(details.candidate_is_attendee && details.candidate_email),
      meetingUrl: created.meetingUrl,
    };
  } catch (err) {
    reportError("[scheduling] Google refused the booking", result.id, isCalendarError(err) ? err.code : "error");
    await deps.admin.rpc("cancel_interview_as_system", { p_id: result.id, p_reason: "calendar_failed" });
    return fail("calendar_failed");
  }
}

/** A warning to show when the change was saved but Google couldn't follow. */
export type CalendarFollowUp = { calendarWarning?: string };

/**
 * IVT-044 (IV-REQ-023, IV-REQ-023b): after `update_interview` applied, the
 * Google event follows: a new time or panel is patched on the organizer's
 * calendar (Google emails the attendees). When the organizer is disconnected
 * or gone, a reschedule recreates the event on the acting member's calendar
 * and they become the organizer.
 */
export async function syncUpdatedInterview(
  deps: SchedulingDeps,
  interviewId: string,
  changed: { time: boolean; panel: boolean },
): Promise<CalendarFollowUp> {
  if (!changed.time && !changed.panel) return {};
  const details = await loadEventDetails(deps.admin, interviewId);
  if (!details || details.source === "manual" || !details.provider_event_id || details.status !== "scheduled") {
    return {};
  }

  if (details.organizer_connection_id) {
    try {
      await withCalendarAuth(deps.admin, details.organizer_connection_id, (token) =>
        deps.provider.updateEvent(token, details.provider_event_id!, {
          ...(changed.time ? { start: details.starts_at!, end: details.ends_at!, timeZone: details.time_zone } : {}),
          ...(changed.panel ? { attendees: attendeesOf(details) } : {}),
        }),
      );
      return {};
    } catch (err) {
      reportError("[scheduling] couldn't patch the event", interviewId, isCalendarError(err) ? err.code : "error");
      return { calendarWarning: schedulingMessage("calendar_update_failed") };
    }
  }

  // IV-REQ-023b: the organizer can't be acted for any more.
  if (!changed.time) return { calendarWarning: schedulingMessage("organizer_disconnected") };
  return moveToActingMember(deps, details);
}

async function moveToActingMember(deps: SchedulingDeps, details: EventDetails): Promise<CalendarFollowUp> {
  const { data: connection } = await deps.admin
    .from("calendar_connections")
    .select("id")
    .eq("user_id", deps.userId)
    .eq("company_id", details.company_id)
    .eq("provider", "google")
    .eq("status", "active")
    .maybeSingle();
  if (!connection) return { calendarWarning: schedulingMessage("organizer_disconnected") };
  try {
    const created = await withCalendarAuth(deps.admin, connection.id, (token) =>
      deps.provider.createEvent(token, eventInputOf(details)),
    );
    await deps.admin
      .from("scheduled_interviews")
      .update({
        provider_event_id: created.eventId,
        meeting_url: created.meetingUrl,
        organizer_user_id: deps.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", details.id)
      .eq("status", "scheduled");
    return {};
  } catch (err) {
    reportError("[scheduling] couldn't recreate the event", details.id, isCalendarError(err) ? err.code : "error");
    return { calendarWarning: schedulingMessage("calendar_update_failed") };
  }
}

/**
 * IVT-044: after `cancel_interview` applied, the Google event is deleted
 * (Google emails the attendees). A failed delete is queued for the calendar
 * ops worker to retry; a disconnected organizer's event can't be deleted.
 */
export async function syncCancelledInterview(deps: SchedulingDeps, interviewId: string): Promise<CalendarFollowUp> {
  const details = await loadEventDetails(deps.admin, interviewId);
  if (!details?.provider_event_id) return {};
  if (!details.organizer_connection_id) return { calendarWarning: schedulingMessage("organizer_disconnected_cancel") };
  try {
    await withCalendarAuth(deps.admin, details.organizer_connection_id, (token) =>
      deps.provider.deleteEvent(token, details.provider_event_id!),
    );
    return {};
  } catch (err) {
    reportError("[scheduling] couldn't delete the event; queued", interviewId, isCalendarError(err) ? err.code : "error");
    await deps.admin.rpc("queue_interview_calendar_op", { p_interview_id: interviewId, p_op: "delete" });
    return {};
  }
}
