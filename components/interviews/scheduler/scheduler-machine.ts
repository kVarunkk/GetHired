// The scheduler's steps (IVT-045) as a pure reducer, tested event by event.
// Book: pick the interview and the panel, find times, pick one, book.
// Send link (IVT-065): the same interview and panel, plus the email.
// Record manually is its own form (RecordInterviewForm).

import { PLAN_LIMITS } from "@/helpers/interviews/config";
import { hasSchedulingLink, type LinkTemplate } from "@/helpers/interviews/scheduling-schema";
import type { MemberCalendarStatus, PanelMemberCalendar } from "@/helpers/interviews/scheduling";

export type SchedulerPlanItem = {
  id: string;
  name: string;
  stageName: string;
  durationMinutes: number;
  defaultInterviewerIds: string[];
  /** This application already has it scheduled or waiting for the candidate: it can't be booked again. */
  scheduled?: boolean;
};

/** Where the scheduler starts: the first plan interview that isn't scheduled yet. */
export const firstOpenItem = <T extends { scheduled?: boolean }>(items: T[]): T | undefined =>
  items.find((p) => !p.scheduled);

export type Slot = { start: string; end: string };

/** Radix SelectItem can't have an empty value. */
export const AD_HOC = "__ad_hoc__";

export type SchedulerTab = "book" | "link" | "record";

export type { LinkTemplate };


type Search =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; slots: Slot[]; members: PanelMemberCalendar[] }
  | { status: "error"; error: string };

export type SchedulerState = {
  tab: SchedulerTab;
  /** The session member's own calendar is connected: they'd organize the booking. */
  connected: boolean;
  planItemId: string;
  name: string;
  durationMinutes: number;
  panel: string[];
  search: Search;
  slot: Slot | null;
  submitting: boolean;
  error: string | null;
  /** Send link: the template and its subject and body as edited. */
  templateId: string | null;
  subject: string;
  body: string;
  /** Bumped whenever the search inputs change, so a stale answer is dropped. */
  version: number;
  searchedVersion: number | null;
};

export type SchedulerEvent =
  | { type: "tab"; tab: SchedulerTab }
  | { type: "item"; item: SchedulerPlanItem | null }
  | { type: "name"; name: string }
  | { type: "duration"; minutes: number }
  | { type: "panel"; panel: string[] }
  | { type: "search" }
  | { type: "found"; slots: Slot[]; members: PanelMemberCalendar[] }
  | { type: "searchFailed"; error: string }
  | { type: "pick"; slot: Slot }
  | { type: "template"; template: LinkTemplate }
  | { type: "subject"; subject: string }
  | { type: "body"; body: string }
  | { type: "submit" }
  | { type: "failed"; error: string; reason?: string }
  | { type: "done" };

export function initialScheduler({
  planItems,
  connected,
  templates = [],
}: {
  planItems: SchedulerPlanItem[];
  connected: boolean;
  templates?: LinkTemplate[];
}): SchedulerState {
  const first = firstOpenItem(planItems);
  const template = templates[0];
  return {
    tab: connected ? "book" : "record",
    connected,
    planItemId: first?.id ?? AD_HOC,
    name: "",
    durationMinutes: first?.durationMinutes ?? PLAN_LIMITS.durationDefault,
    panel: first?.defaultInterviewerIds ?? [],
    search: { status: "idle" },
    slot: null,
    submitting: false,
    error: null,
    templateId: template?.id ?? null,
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    version: 0,
    searchedVersion: null,
  };
}

/** A change to what the search depends on: the old times no longer apply. */
const changed = (s: SchedulerState, patch: Partial<SchedulerState>): SchedulerState => ({
  ...s,
  ...patch,
  search: { status: "idle" },
  slot: null,
  error: null,
  version: s.version + 1,
  searchedVersion: null,
});

export function schedulerReducer(s: SchedulerState, e: SchedulerEvent): SchedulerState {
  switch (e.type) {
    case "tab":
      return { ...s, tab: e.tab, error: null };
    case "item":
      if (!e.item) return changed(s, { planItemId: AD_HOC });
      return changed(s, {
        planItemId: e.item.id,
        durationMinutes: e.item.durationMinutes,
        // Prefill the plan's default interviewers, keeping anyone already picked.
        panel: s.panel.length === 0 ? e.item.defaultInterviewerIds : s.panel,
      });
    case "name":
      return { ...s, name: e.name, error: null };
    case "duration":
      return changed(s, { durationMinutes: e.minutes });
    case "panel":
      return changed(s, { panel: e.panel });
    case "search":
      return { ...s, search: { status: "loading" }, slot: null, error: null, searchedVersion: s.version };
    case "found":
      if (s.searchedVersion !== s.version || s.search.status !== "loading") return s;
      return { ...s, search: { status: "ready", slots: e.slots, members: e.members } };
    case "searchFailed":
      if (s.searchedVersion !== s.version || s.search.status !== "loading") return s;
      return { ...s, search: { status: "error", error: e.error } };
    case "pick":
      return { ...s, slot: e.slot, error: null };
    case "template":
      return { ...s, templateId: e.template.id, subject: e.template.subject, body: e.template.body, error: null };
    case "subject":
      return { ...s, subject: e.subject, error: null };
    case "body":
      return { ...s, body: e.body, error: null };
    case "submit":
      return { ...s, submitting: true, error: null };
    case "failed": {
      const next = { ...s, submitting: false, error: e.error };
      if (e.reason !== "slot_taken" || !s.slot || s.search.status !== "ready") return next;
      const taken = s.slot;
      return {
        ...next,
        slot: null,
        search: { ...s.search, slots: s.search.slots.filter((x) => x.start !== taken.start) },
      };
    }
    case "done":
      return { ...s, submitting: false };
  }
}

const adHocReady = (s: SchedulerState) =>
  s.planItemId !== AD_HOC || (s.name.trim().length > 0 && Number.isFinite(s.durationMinutes));

export const canSearch = (s: SchedulerState) =>
  s.connected && s.panel.length > 0 && s.search.status !== "loading" && !s.submitting && Number.isFinite(s.durationMinutes);

export const canBook = (s: SchedulerState) =>
  s.connected && s.slot !== null && s.panel.length > 0 && !s.submitting && adHocReady(s);

export type LinkBlockReason = "not_connected" | "organizer_reconnect" | "no_candidate_email" | "panel_not_connected";
export type LinkBlocker = { reason: LinkBlockReason; userIds: string[] } | null;

/**
 * Why a link can't be sent (IV-REQ-012, D20), as create_scheduling_link would
 * answer: the member organizes the booking, so their calendar must work; the
 * candidate must be emailable; and every panel member must be connected, or
 * the page couldn't show when they're free. `userIds`: the panel members.
 */
export function linkBlocker(
  calendar: { own: "active" | "error" | null; members: Record<string, MemberCalendarStatus>; candidateInvitable: boolean },
  panel: string[],
): LinkBlocker {
  if (calendar.own === null) return { reason: "not_connected", userIds: [] };
  if (calendar.own === "error") return { reason: "organizer_reconnect", userIds: [] };
  if (!calendar.candidateInvitable) return { reason: "no_candidate_email", userIds: [] };
  const missing = panel.filter((id) => calendar.members[id] !== "connected");
  return missing.length > 0 ? { reason: "panel_not_connected", userIds: missing } : null;
}

export const canSendLink = (s: SchedulerState, blocker: LinkBlocker) =>
  blocker === null &&
  s.templateId !== null &&
  s.subject.trim().length > 0 &&
  hasSchedulingLink(s.body) &&
  s.panel.length > 0 &&
  !s.submitting &&
  adHocReady(s) &&
  Number.isFinite(s.durationMinutes);

/** Slots grouped by calendar day in `timeZone`, in order. */
export function slotsByDay(slots: Slot[], timeZone?: string): { day: string; slots: Slot[] }[] {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const days: { day: string; slots: Slot[] }[] = [];
  for (const slot of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = key.format(new Date(slot.start));
    const last = days[days.length - 1];
    if (last?.day === day) last.slots.push(slot);
    else days.push({ day, slots: [slot] });
  }
  return days;
}
