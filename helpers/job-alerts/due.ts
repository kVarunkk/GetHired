import type { JobAlertFrequency } from "./filters";

/**
 * When an alert runs (JA-REQ-030, JA-DEC-005). One daily cron; weekly alerts
 * only on Mondays (UTC). Client-safe and pure.
 */

/** An alert checked within this long is skipped, so a late or repeated run doesn't send twice. */
export const ALERT_DUE_AFTER_HOURS = 20;
/** The longest window an alert looks back, so a long-paused alert doesn't send a backlog. */
export const ALERT_MAX_WINDOW_DAYS = 14;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type DueAlert = { frequency: string; last_checked_at: string | null };

/** Monday in UTC, the day weekly alerts go out. */
export const isWeeklySendDay = (now: Date) => now.getUTCDay() === 1;

/** The cut-off the worker's SQL uses: alerts last checked before it (or never) are candidates. */
export const dueCheckedBefore = (now: Date) => new Date(now.getTime() - ALERT_DUE_AFTER_HOURS * HOUR);

export function isAlertDue(alert: DueAlert, now: Date): boolean {
  const checkedLongAgo =
    alert.last_checked_at === null || new Date(alert.last_checked_at).getTime() < dueCheckedBefore(now).getTime();
  if (!checkedLongAgo) return false;
  if ((alert.frequency as JobAlertFrequency) === "weekly") return isWeeklySendDay(now);
  return true;
}

/** New jobs are those posted after this: `max(last_checked_at, created_at, now − 14 days)`. */
export function alertWindowStart(alert: { last_checked_at: string | null; created_at: string }, now: Date): Date {
  const candidates = [new Date(alert.created_at).getTime(), now.getTime() - ALERT_MAX_WINDOW_DAYS * DAY];
  if (alert.last_checked_at) candidates.push(new Date(alert.last_checked_at).getTime());
  return new Date(Math.max(...candidates));
}

/** "daily" / "every Monday", for the banner and the email. */
export const frequencyPhrase = (frequency: JobAlertFrequency) => (frequency === "daily" ? "daily" : "every Monday");
