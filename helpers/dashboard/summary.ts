// Client-safe. What the applicant dashboard works out from data the page
// already loads: what needs the user today, where their applications stand,
// what they saved but haven't applied to, and how complete their profile is.

import { daysSince, isFollowUpDue, todayIso } from "@/helpers/tracker/card";
import { boardColumnLabel, suggestsGhosted, type BoardColumn } from "@/helpers/tracker/status";
import type { SavedJobItem, TrackerItem } from "@/helpers/tracker/types";
import type { Database } from "@/utils/types/database.types";

// --- Needs your attention ---------------------------------------------------

export type AttentionReason =
  | { kind: "follow_up"; due: string; overdue: boolean }
  | { kind: "no_reply"; days: number }
  | { kind: "update"; label: string; changedAt: string };

export type AttentionItem = { item: TrackerItem; reason: AttentionReason };

/** How far back a company's status change still counts as news. */
export const RECENT_UPDATE_DAYS = 7;

/**
 * The applications that need the user, each once, in this order: follow-ups
 * due (oldest first), tracked cards with no reply in 30 days (the board's
 * "Mark as ghosted?" rule), then GetHired applications a company moved in the
 * last week. A user's own moves on their tracked cards aren't news.
 */
export function attentionItems(items: TrackerItem[], now: Date = new Date()): AttentionItem[] {
  const today = todayIso(now);
  const followUps: AttentionItem[] = [];
  const noReply: AttentionItem[] = [];
  const updates: AttentionItem[] = [];

  for (const item of items) {
    if (item.column !== "closed" && item.nextFollowUpAt && isFollowUpDue(item.nextFollowUpAt, now)) {
      followUps.push({ item, reason: { kind: "follow_up", due: item.nextFollowUpAt, overdue: item.nextFollowUpAt < today } });
    } else if (item.kind === "tracked" && item.status && suggestsGhosted(item.status, item.statusChangedAt, now)) {
      noReply.push({ item, reason: { kind: "no_reply", days: daysSince(item.statusChangedAt, now) } });
    } else if (
      item.kind === "gethired" &&
      item.column !== "applied" &&
      daysSince(item.statusChangedAt, now) < RECENT_UPDATE_DAYS
    ) {
      updates.push({ item, reason: { kind: "update", label: item.statusLabel, changedAt: item.statusChangedAt } });
    }
  }

  const due = (a: AttentionItem) => (a.reason.kind === "follow_up" ? a.reason.due : "");
  const days = (a: AttentionItem) => (a.reason.kind === "no_reply" ? a.reason.days : 0);
  const changed = (a: AttentionItem) => (a.reason.kind === "update" ? a.reason.changedAt : "");
  followUps.sort((a, b) => due(a).localeCompare(due(b)));
  noReply.sort((a, b) => days(b) - days(a));
  updates.sort((a, b) => changed(b).localeCompare(changed(a)));
  return [...followUps, ...noReply, ...updates];
}

const plural = (count: number, one: string, many: string = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The line under the greeting: "2 follow-ups due · 1 upcoming interview", or all caught up. */
export function dashboardHeadline({
  attention,
  scheduledInterviews,
  screeningInterviews,
}: {
  attention: AttentionItem[];
  scheduledInterviews: number;
  screeningInterviews: number;
}): string {
  const count = (kind: AttentionReason["kind"]) => attention.filter((a) => a.reason.kind === kind).length;
  const parts = [
    scheduledInterviews > 0 && plural(scheduledInterviews, "upcoming interview"),
    screeningInterviews > 0 && plural(screeningInterviews, "AI screening interview") + " to take",
    count("follow_up") > 0 && `${plural(count("follow_up"), "follow-up")} due`,
    count("update") > 0 && plural(count("update"), "new update"),
    count("no_reply") > 0 && `${plural(count("no_reply"), "application")} with no reply`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "You're all caught up.";
}

// --- Pipeline -----------------------------------------------------------------

export type PipelineStage = { column: BoardColumn; label: string; count: number };

export type Pipeline = {
  total: number;
  stages: PipelineStage[];
  /** Applications a company answered: moved on, interviewed, offered or rejected. */
  responded: number;
  /** Whole percent; null until there are enough applications to mean something. */
  responseRate: number | null;
  /** Applied in the last 7 days, today included. */
  thisWeek: number;
};

/** Fewer applications than this and a response rate is noise. */
export const MIN_FOR_RESPONSE_RATE = 3;

const PIPELINE_COLUMNS: BoardColumn[] = ["applied", "in_review", "interviewing", "offer", "closed"];

/**
 * Whether a company answered. Withdrawn and ghosted tracked cards closed with
 * no answer; a closed GetHired application was rejected, which is an answer.
 */
export function gotResponse(item: Pick<TrackerItem, "kind" | "column" | "status">): boolean {
  if (item.column === "applied") return false;
  if (item.column !== "closed") return true;
  if (item.kind === "gethired") return true;
  return item.status === "accepted" || item.status === "rejected";
}

export function pipelineOf(items: TrackerItem[], now: Date = new Date()): Pipeline {
  const stages = PIPELINE_COLUMNS.map((column) => ({
    column,
    label: boardColumnLabel(column),
    count: items.filter((item) => item.column === column).length,
  }));
  const responded = items.filter(gotResponse).length;
  return {
    total: items.length,
    stages,
    responded,
    responseRate: items.length >= MIN_FOR_RESPONSE_RATE ? Math.round((responded / items.length) * 100) : null,
    thisWeek: items.filter((item) => daysSince(item.appliedAt, now) < 7).length,
  };
}

// --- Saved, not applied -------------------------------------------------------

/** Saved jobs with no application yet, newest saved first. Tracked `saved` rows never have one. */
export function savedNotApplied(saved: SavedJobItem[], applications: TrackerItem[], limit = 3): SavedJobItem[] {
  const applied = new Set(applications.map((item) => item.allJobsId).filter(Boolean));
  return saved
    .filter((item) => item.kind === "tracked" || !applied.has(item.allJobsId))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, limit);
}

// --- Profile checklist --------------------------------------------------------

type UserInfo = Database["public"]["Tables"]["user_info"]["Row"];

export type ProfileFields = Pick<
  UserInfo,
  | "desired_roles"
  | "top_skills"
  | "preferred_locations"
  | "min_salary"
  | "max_salary"
  | "experience_years"
  | "linkedin_url"
  | "github_url"
> & { hasResume: boolean };

const filled = (list: string[] | null) => (list?.length ?? 0) > 0;

/** What improves matches, in the order the user should do it. */
export const PROFILE_CHECKS: { id: string; label: string; done: (p: ProfileFields) => boolean }[] = [
  { id: "resume", label: "Upload your resume", done: (p) => p.hasResume },
  { id: "roles", label: "Add the roles you want", done: (p) => filled(p.desired_roles) },
  { id: "skills", label: "List your top skills", done: (p) => filled(p.top_skills) },
  { id: "experience", label: "Add your years of experience", done: (p) => p.experience_years !== null },
  { id: "locations", label: "Choose where you want to work", done: (p) => filled(p.preferred_locations) },
  { id: "salary", label: "Set your salary expectations", done: (p) => p.min_salary !== null || p.max_salary !== null },
  { id: "links", label: "Link your LinkedIn or GitHub", done: (p) => Boolean(p.linkedin_url || p.github_url) },
];

export type ProfileProgress = { done: number; total: number; percent: number; missing: { id: string; label: string }[] };

export function profileProgress(profile: ProfileFields): ProfileProgress {
  const missing = PROFILE_CHECKS.filter((check) => !check.done(profile)).map(({ id, label }) => ({ id, label }));
  const total = PROFILE_CHECKS.length;
  const done = total - missing.length;
  return { done, total, percent: Math.round((done / total) * 100), missing };
}
