import "server-only";
import { listMyScreeningInterviews } from "@/helpers/interview/screening/my-interviews";
import { listMyScheduledInterviews } from "@/helpers/interviews/my-scheduled-interviews";
import type { TrackerContext, TrackerSource, TrackedRow } from "./context";
import { filterByKeyword } from "./search";
import {
  columnOf,
  gethiredColumn,
  gethiredStatusLabel,
  legacyTrackedStatus,
  trackedStatusLabel,
  type ApplicationStatus,
  type BoardColumn,
  type TrackedStatus,
} from "./status";
import type { TrackerItem } from "./types";

/**
 * What a GetHired card may read: the candidate-facing status and the job.
 * Never `stage_id`, a stage kind or a stage name (AT-REQ-021, AT-DEC-004);
 * list-my-applications.test.ts pins this list.
 */
export const GETHIRED_APPLICATION_COLUMNS =
  "id, status, created_at, updated_at, all_jobs_id, job_post_id, all_jobs ( id, job_name, company_name, locations, status )";

export const TRACKED_COLUMNS =
  "id, all_jobs_id, job_title, company_name, job_url, location, status, status_changed_at, applied_at, next_follow_up_at, notes, source, position, created_at, updated_at, all_jobs ( status )";

/** Screening interviews that put a card in Interviewing. */
const LIVE_SCREENING = new Set(["invited", "in_progress", "paused", "completed"]);
/** The screening interview the card's menu opens. */
const OPEN_SCREENING = new Set(["invited", "in_progress", "paused"]);
const LIVE_SCHEDULED = new Set(["awaiting_candidate", "scheduled", "completed"]);

type ApplicationRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string | null;
  all_jobs_id: string | null;
  job_post_id: string | null;
  all_jobs: { id: string; job_name: string | null; company_name: string | null; locations: string[] | null; status: string | null } | null;
};

/** A linked board job that's no longer open (closed or archived by the company). */
const closedJob = (job: { status: string | null } | null | undefined) => Boolean(job && job.status !== "active");

type TrackedListRow = Pick<
  TrackedRow,
  | "id"
  | "all_jobs_id"
  | "job_title"
  | "company_name"
  | "job_url"
  | "location"
  | "status"
  | "status_changed_at"
  | "applied_at"
  | "next_follow_up_at"
  | "notes"
  | "source"
  | "position"
  | "created_at"
  | "updated_at"
> & { all_jobs?: { status: string | null } | null };

export type ListMyApplicationsFilters = {
  q?: string | null;
  /** Only cards in these tracked statuses (tracked cards only). */
  statuses?: TrackedStatus[];
  /** Only cards in this column (both kinds). */
  column?: BoardColumn;
};

export function trackedItem(row: TrackedListRow): TrackerItem {
  return {
    kind: "tracked",
    id: row.id,
    allJobsId: row.all_jobs_id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    location: row.location,
    jobUrl: row.job_url,
    status: row.status,
    gethiredStatus: null,
    statusLabel: trackedStatusLabel(row.status),
    column: columnOf(row.status) ?? "applied",
    onHold: false,
    appliedAt: row.applied_at ?? row.created_at.slice(0, 10),
    statusChangedAt: row.status_changed_at,
    updatedAt: row.updated_at,
    nextFollowUpAt: row.next_follow_up_at,
    notes: row.notes,
    source: row.source as TrackerSource,
    position: row.position,
    legacy: false,
    screeningInterviewId: null,
    jobClosed: closedJob(row.all_jobs),
  };
}

const jobText = (value: string | null | undefined, fallback: string) => value?.trim() || fallback;

/**
 * Every application of the session applicant, both kinds, newest applied
 * first (AT-REQ-021): GetHired applications (read-only, columns from status
 * and interviews), tracked cards except `saved`, and old external rows until
 * migration B.
 */
export async function listMyApplications(ctx: TrackerContext, filters: ListMyApplicationsFilters = {}): Promise<TrackerItem[]> {
  const { supabase, user } = ctx;

  const [applicationsRes, trackedRes, notesRes, screening, scheduled] = await Promise.all([
    supabase
      .from("applications")
      .select(GETHIRED_APPLICATION_COLUMNS)
      .eq("applicant_user_id", user.id)
      .is("merged_into_application_id", null)
      .not("all_jobs_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("tracked_applications")
      .select(TRACKED_COLUMNS)
      .eq("user_id", user.id)
      .neq("status", "saved")
      .order("applied_at", { ascending: false }),
    supabase.from("applicant_application_notes").select("application_id, notes, next_follow_up_at").eq("user_id", user.id),
    listMyScreeningInterviews(supabase),
    listMyScheduledInterviews(supabase),
  ]);
  if (applicationsRes.error) throw applicationsRes.error;
  if (trackedRes.error) throw trackedRes.error;

  const tracked = ((trackedRes.data ?? []) as TrackedListRow[]).map(trackedItem);
  const trackedJobIds = new Set(tracked.map((item) => item.allJobsId).filter(Boolean));
  const notes = new Map((notesRes.data ?? []).map((note) => [note.application_id, note]));

  const screeningByApplication = new Map<string, { live: boolean; openId: string | null }>();
  for (const interview of screening) {
    const current = screeningByApplication.get(interview.application_id) ?? { live: false, openId: null };
    screeningByApplication.set(interview.application_id, {
      live: current.live || LIVE_SCREENING.has(interview.status),
      openId: current.openId ?? (OPEN_SCREENING.has(interview.status) ? interview.id : null),
    });
  }
  const scheduledApplications = new Set(
    scheduled.filter((interview) => LIVE_SCHEDULED.has(interview.status)).map((interview) => interview.application_id),
  );

  const gethired: TrackerItem[] = [];
  const legacy: TrackerItem[] = [];
  for (const row of (applicationsRes.data ?? []) as ApplicationRow[]) {
    const job = row.all_jobs;
    const base = {
      allJobsId: row.all_jobs_id,
      jobTitle: jobText(job?.job_name, "Untitled job"),
      companyName: jobText(job?.company_name, "Unknown company"),
      location: job?.locations?.[0] ?? null,
      appliedAt: row.created_at.slice(0, 10),
      updatedAt: row.updated_at ?? row.created_at,
      position: Date.parse(row.created_at) / 1000,
      jobClosed: closedJob(job),
    };

    if (row.job_post_id) {
      const interview = screeningByApplication.get(row.id);
      const placement = gethiredColumn(row.status, {
        screening: interview?.live ?? false,
        scheduled: scheduledApplications.has(row.id),
      });
      const note = notes.get(row.id);
      gethired.push({
        ...base,
        kind: "gethired",
        id: row.id,
        jobUrl: null,
        status: null,
        gethiredStatus: row.status,
        statusLabel: placement.column === "interviewing" ? "Interviewing" : gethiredStatusLabel(row.status),
        column: placement.column,
        onHold: placement.onHold,
        statusChangedAt: row.updated_at ?? row.created_at,
        nextFollowUpAt: note?.next_follow_up_at ?? null,
        notes: note?.notes ?? null,
        source: "gethired",
        legacy: false,
        screeningInterviewId: interview?.openId ?? null,
      });
    } else if (row.all_jobs_id && !trackedJobIds.has(row.all_jobs_id)) {
      const status = legacyTrackedStatus(row.status);
      legacy.push({
        ...base,
        kind: "tracked",
        id: row.id,
        jobUrl: null,
        status,
        gethiredStatus: null,
        statusLabel: trackedStatusLabel(status),
        column: columnOf(status) ?? "applied",
        onHold: false,
        statusChangedAt: row.updated_at ?? row.created_at,
        nextFollowUpAt: null,
        notes: null,
        source: "migrated",
        legacy: true,
        screeningInterviewId: null,
      });
    }
  }

  let items = [...tracked, ...legacy, ...gethired];
  if (filters.statuses?.length) {
    const wanted = new Set(filters.statuses);
    items = items.filter((item) => item.status !== null && wanted.has(item.status));
  }
  if (filters.column) items = items.filter((item) => item.column === filters.column);
  items = filterByKeyword(items, filters.q);

  return items.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.updatedAt.localeCompare(a.updatedAt));
}
