import type { ScreeningRecommendation } from "./config";
import { parseStoredScreening, type ScreeningResult } from "./schemas";

export type ScreeningStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "stale"
  | "skipped_quota";

/** The `application_screenings` columns a company sees. */
export const SCREENING_VIEW_COLUMNS =
  "id, application_id, status, fit_score, recommendation, result, error_code, completed_at, updated_at";

/**
 * A screening as the company UI gets it: `result` parsed through the schema,
 * only a safe `error_code`, and no `previous_result` or snapshot hash.
 */
export type ScreeningView = {
  id: string;
  application_id: string;
  status: ScreeningStatus;
  fit_score: number | null;
  recommendation: ScreeningRecommendation | null;
  result: ScreeningResult | null;
  error_code: string | null;
  completed_at: string | null;
  updated_at: string;
};

export function toScreeningView(row: {
  id: string;
  application_id: string;
  status: string;
  fit_score: number | null;
  recommendation: string | null;
  result: unknown;
  error_code: string | null;
  completed_at: string | null;
  updated_at: string;
}): ScreeningView {
  return {
    id: row.id,
    application_id: row.application_id,
    status: row.status as ScreeningStatus,
    fit_score: row.fit_score,
    recommendation: row.recommendation as ScreeningRecommendation | null,
    result: parseStoredScreening(row.result),
    error_code: row.error_code,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

/** Statuses the UI shows as "Screening…" and polls. */
export const isScreeningInProgress = (status: ScreeningStatus | undefined) =>
  status === "queued" || status === "processing";
