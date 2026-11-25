// Client-safe. Whether the user applied to a board job, as job cards and job
// pages show it (AT-REQ-034): a tracked row (any status but `saved`) or an
// `applications` row (a GetHired application, or an old external one until
// migration B moves it).

import { myJobsPath, trackedApplicationPath } from "./paths";
import { legacyTrackedStatus, trackedStatusLabel, isTrackedStatus, type ApplicationStatus, type AppliedStatus } from "./status";

export type ProfileApplication = { id?: string; all_jobs_id: string | null; job_post_id?: string | null; status: string };
export type ProfileTracked = { id?: string; all_jobs_id: string | null; status: string };

export type AppliedJob = {
  all_jobs_id: string;
  /** The `applications` status for a GetHired application; the tracked status otherwise. */
  status: string;
  statusLabel: string;
  /** "tracked" for a tracked row or an old external application, which the job page menu can change. */
  kind: "tracked" | "application";
  /** The tracked status the menu shows as checked. */
  trackedStatus: AppliedStatus | null;
};

const APPLICATION_STATUSES = new Set(["submitted", "reviewed", "selected", "stand_by", "rejected"]);

/**
 * The applied state of one job. `isPlatformJob` says whether an
 * `applications` row is a GetHired application (shown as is) or an old
 * external row (read through the §7.2 mapping).
 */
export function appliedJobFor(
  profile: { applications?: ProfileApplication[] | null; tracked_applications?: ProfileTracked[] | null } | null | undefined,
  jobId: string,
  isPlatformJob: boolean,
): AppliedJob | undefined {
  const tracked = profile?.tracked_applications?.find((row) => row.all_jobs_id === jobId && row.status !== "saved");
  if (tracked && isTrackedStatus(tracked.status) && tracked.status !== "saved") {
    return {
      all_jobs_id: jobId,
      status: tracked.status,
      statusLabel: trackedStatusLabel(tracked.status),
      kind: "tracked",
      trackedStatus: tracked.status,
    };
  }

  const application = profile?.applications?.find((row) => row.all_jobs_id === jobId);
  if (!application || !APPLICATION_STATUSES.has(application.status)) return undefined;
  const status = application.status as ApplicationStatus;
  if (isPlatformJob) {
    return { all_jobs_id: jobId, status, statusLabel: status, kind: "application", trackedStatus: null };
  }
  const mapped = legacyTrackedStatus(status);
  return { all_jobs_id: jobId, status: mapped, statusLabel: trackedStatusLabel(mapped), kind: "tracked", trackedStatus: mapped };
}

/**
 * Where the user's own record of a board job lives, for the closed-job page:
 * the card's page for a tracked row or a GetHired application, My Jobs for an
 * old external row (it has no page of its own), or null when they never
 * applied.
 */
export function myApplicationHref(
  profile: { applications?: ProfileApplication[] | null; tracked_applications?: ProfileTracked[] | null } | null | undefined,
  jobId: string,
): string | null {
  const tracked = profile?.tracked_applications?.find((row) => row.all_jobs_id === jobId && row.status !== "saved");
  if (tracked) return tracked.id ? trackedApplicationPath(tracked.id) : myJobsPath();
  const application = profile?.applications?.find((row) => row.all_jobs_id === jobId);
  if (!application) return null;
  return application.id && application.job_post_id ? trackedApplicationPath(application.id) : myJobsPath();
}
