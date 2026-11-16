"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { saveScorecardDraft, type ScorecardSaveResult } from "@/helpers/interviews/scorecards";
import type { ScorecardDraftInput } from "@/helpers/interviews/interview-schema";

/**
 * SERVER ACTION (IVT-018, IV-REQ-030): autosaves the session member's own
 * scorecard. Panel access, not a permission: `save_scorecard_draft` only
 * accepts a panel member's own row. Nothing is revalidated on autosave.
 */
export async function saveScorecardDraftAction(input: ScorecardDraftInput): Promise<ScorecardSaveResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  return saveScorecardDraft(auth.supabase, input);
}
