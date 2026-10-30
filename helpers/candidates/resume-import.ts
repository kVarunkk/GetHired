import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import { getEntitlements, getMemberLimit, releaseHold, type EntitlementRef } from "@/helpers/billing/entitlements";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESUME_BUCKET } from "./resume-files";

// Server helpers shared by the resume import's actions, worker and expiry
// cron (BI-REQ-020 to BI-REQ-026).

export const CANDIDATE_IMPORT_QUEUE = "candidate_import_queue";

export type CandidateImportMessage = { row_id: string };

/** The worker tries a provider or network error this many times before the file fails (BI-REQ-022). */
export const CANDIDATE_IMPORT_MAX_READS = 3;

/**
 * One resume_imports hold per file (BI-REQ-021). A hold is converted or
 * released whole, per ref, so each file has its own and the worker can
 * settle them one at a time.
 */
export const importRowRef = (rowId: string): EntitlementRef => ({ type: "candidate_import_row", id: rowId });

/** Releases each row's hold, if one is left. Never throws. */
export async function releaseRowHolds(companyId: string, rowIds: string[]): Promise<void> {
  await Promise.all(
    rowIds.map((id) =>
      releaseHold(companyId, "resume_imports", importRowRef(id)).catch((err) =>
        reportError("[candidate import] couldn't release a hold", id, err),
      ),
    ),
  );
}

/** Deletes files from the candidate files bucket. Never throws: a stray file is swept by the expiry cron. */
export async function deleteCandidateFiles(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await createServiceRoleClient().storage.from(RESUME_BUCKET).remove(unique);
  if (error) reportError("[candidate import] couldn't delete files", error.message);
}

/**
 * How many of `wanted` resume parses the company (and the member's cap) can
 * pay for right now: the allowance left plus what its credits cover.
 */
export async function resumeImportsThatFit(companyId: string, wanted: number, actorUserId: string): Promise<number> {
  const [entitlements, cap] = await Promise.all([
    getEntitlements(companyId),
    getMemberLimit(companyId, "resume_imports", actorUserId),
  ]);
  const state = entitlements.entitlements.resume_imports;
  let fit =
    state.amount === null
      ? wanted
      : Math.max(state.remaining ?? 0, 0) +
        (state.overageCredits ? Math.floor(entitlements.creditBalance / state.overageCredits) : 0);
  if (cap) fit = Math.min(fit, cap.remaining);
  return Math.max(0, Math.min(fit, wanted));
}

/** Runs `fn` over `items`, `size` at a time. */
export async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}
