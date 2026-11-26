import type { Database } from "@/utils/types/database.types";
import type { SavedJobItem, TrackerItem } from "@/helpers/tracker/types";

// Rows for the application tracker's tests (ATT-010).

export const TRACKER_USER_ID = "00000000-0000-4000-8000-000000000001";
export const BOARD_JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const OTHER_JOB_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

type TrackedRow = Database["public"]["Tables"]["tracked_applications"]["Row"];

let seq = 0;

/** A `tracked_applications` row; applied a week ago unless overridden. */
export function trackedRow(overrides: Partial<TrackedRow> = {}): TrackedRow {
  seq += 1;
  const status = overrides.status ?? "applied";
  return {
    id: `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    user_id: TRACKER_USER_ID,
    all_jobs_id: null,
    job_title: "Frontend Engineer",
    job_description: null,
    company_name: "Acme",
    job_url: "https://boards.greenhouse.io/acme/jobs/1",
    job_url_key: "boards.greenhouse.io/acme/jobs/1",
    location: "Remote",
    status,
    status_changed_at: "2026-11-17T10:00:00.000Z",
    applied_at: status === "saved" ? null : "2026-11-17",
    next_follow_up_at: null,
    resume_id: null,
    salary_amount: null,
    salary_currency: null,
    contact_name: null,
    notes: null,
    source: "manual",
    position: 1000 + seq,
    created_at: "2026-11-17T10:00:00.000Z",
    updated_at: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

/** A board job as `addTrackedApplication` reads it. */
export function boardJob(overrides: Partial<{ id: string; job_name: string; company_name: string; locations: string[]; is_platform_job: boolean }> = {}) {
  return {
    id: BOARD_JOB_ID,
    job_name: "Backend Engineer",
    company_name: "Globex",
    locations: ["Bengaluru", "Remote"],
    is_platform_job: false,
    ...overrides,
  };
}

/** A GetHired application as `listMyApplications` selects it. */
export function gethiredApplication(
  overrides: Partial<{
    id: string;
    status: Database["public"]["Enums"]["application_status"];
    created_at: string;
    updated_at: string;
    all_jobs_id: string;
    job_post_id: string;
  }> = {},
) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    status: "submitted" as Database["public"]["Enums"]["application_status"],
    created_at: "2026-11-20T10:00:00.000Z",
    updated_at: "2026-11-20T10:00:00.000Z",
    all_jobs_id: BOARD_JOB_ID,
    job_post_id: "30000000-0000-4000-8000-000000000001",
    all_jobs: { id: BOARD_JOB_ID, job_name: "Platform Engineer", company_name: "Initech", locations: ["Pune"], status: "active" },
    ...overrides,
  };
}

let itemSeq = 0;

/** A `TrackerItem`: a tracked card in Applied unless overridden. */
export function trackerItem(overrides: Partial<TrackerItem> = {}): TrackerItem {
  itemSeq += 1;
  return {
    kind: "tracked",
    id: `40000000-0000-4000-8000-${String(itemSeq).padStart(12, "0")}`,
    allJobsId: null,
    jobTitle: `Engineer ${itemSeq}`,
    companyName: "Acme",
    location: "Remote",
    jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
    status: "applied",
    gethiredStatus: null,
    statusLabel: "Applied",
    column: "applied",
    onHold: false,
    appliedAt: "2026-11-17",
    statusChangedAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    nextFollowUpAt: null,
    notes: null,
    source: "manual",
    position: itemSeq,
    legacy: false,
    screeningInterviewId: null,
    jobClosed: false,
    ...overrides,
  };
}

/** A GetHired card, read-only on the board. */
export const gethiredItem = (overrides: Partial<TrackerItem> = {}) =>
  trackerItem({ kind: "gethired", status: null, gethiredStatus: "submitted", source: "gethired", jobUrl: null, ...overrides });

/** A Saved tab item: a board favorite unless overridden. */
export function savedItem(overrides: Partial<SavedJobItem> = {}): SavedJobItem {
  itemSeq += 1;
  if (overrides.kind === "tracked") {
    return {
      kind: "tracked",
      id: `50000000-0000-4000-8000-${String(itemSeq).padStart(12, "0")}`,
      allJobsId: null,
      jobTitle: "Designer",
      companyName: "Hooli",
      location: "Berlin",
      jobUrl: "https://jobs.lever.co/hooli/1",
      notes: null,
      savedAt: "2026-11-20T10:00:00.000Z",
      ...overrides,
    } as SavedJobItem;
  }
  return {
    kind: "favorite",
    id: BOARD_JOB_ID,
    allJobsId: BOARD_JOB_ID,
    jobTitle: "Backend Engineer",
    companyName: "Globex",
    location: "Pune",
    savedAt: "2026-11-21T10:00:00.000Z",
    ...overrides,
  } as SavedJobItem;
}
