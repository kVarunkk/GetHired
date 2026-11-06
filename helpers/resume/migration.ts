// The file migration's tunables and rules (plan/resume-editor/feature-resume-editor-spec.md
// §10). Client-safe: nothing here touches the database, so the worker, the
// enqueue route, the deletion route and their tests share one definition.

import { RESUME_MIGRATION_MIN_COVERAGE } from "./config";

/** The queue the re-parse worker reads (RE-REQ-092). */
export const RESUME_REPARSE_QUEUE = "resume_reparse_queue";

/** Files re-parsed per worker run. Small, so one bad file can't stall the rest. */
export const RESUME_REPARSE_BATCH_SIZE = 5;
/** Seconds a failed message waits before the worker sees it again. */
export const RESUME_REPARSE_VISIBILITY_SECONDS = 120;
/** How many times the worker retries a provider or network error before failing the item. */
export const RESUME_REPARSE_MAX_ATTEMPTS = 3;
/** Files deleted per deletion run (RE-REQ-098). */
export const RESUME_FILE_DELETION_BATCH_SIZE = 50;
/** Days after the re-upload email before a failed file is deleted (RE-REQ-098, RE-DEC-009). */
export const RESUME_FILE_DELETION_GRACE_DAYS = 30;

export const RESUME_MIGRATION_STATUSES = ["pending", "parsed", "low_coverage", "failed", "skipped"] as const;
export type ResumeMigrationStatus = (typeof RESUME_MIGRATION_STATUSES)[number];

/**
 * Whether the deletion switch is on. It defaults to off, so the route ships
 * inert until RET-115 turns it on (RE-REQ-098).
 */
export function resumeFileDeletionEnabled(value: string | undefined = process.env.RESUME_FILE_DELETION_ENABLED) {
  return value === "true" || value === "1";
}

/**
 * The status a re-parsed file gets: `parsed` when the model used enough of the
 * text, `low_coverage` when it didn't (RE-REQ-096). A file sent to the model
 * directly has no coverage to judge, so it counts as parsed.
 */
export function migrationStatusFor(coverage: number | null): ResumeMigrationStatus {
  if (coverage === null) return "parsed";
  return coverage < RESUME_MIGRATION_MIN_COVERAGE ? "low_coverage" : "parsed";
}

/** True for a message worth retrying: a provider or network error, not an unreadable file. */
export function shouldRetryMigration(attempts: number) {
  return attempts < RESUME_REPARSE_MAX_ATTEMPTS;
}

/**
 * True when Storage says the file isn't there, which no retry will change. It
 * can report that as HTTP 400 with `statusCode: "404"`, so both are checked.
 * Anything else, like a timeout, may pass.
 */
export function isMissingFileError(error: { message?: string; status?: number; statusCode?: string }) {
  return error.status === 404 || error.statusCode === "404" || /not found/i.test(error.message ?? "");
}

/**
 * The user from a resume file's path. The upload path is
 * `resumes/<user_id>/<timestamp>-<name>`, so an orphaned file still belongs to
 * someone (RE-REQ-091).
 */
export function userIdFromFilePath(path: string): string | null {
  const match = /^resumes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(path);
  return match ? match[1] : null;
}
