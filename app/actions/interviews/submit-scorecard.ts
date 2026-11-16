"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { applicationPath } from "@/helpers/applications/application-page";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { scorecardMessage } from "@/helpers/interviews/copy";
import { submitScorecard, type ScorecardSubmitResult } from "@/helpers/interviews/scorecards";

/**
 * SERVER ACTION (IVT-018, IV-REQ-031): submits the session member's own
 * scorecard. Panel access, not a permission: `submit_scorecard` only accepts
 * a panel member's own row.
 */
export async function submitScorecardAction({ interviewId }: { interviewId: string }): Promise<ScorecardSubmitResult> {
  if (!isUuid(interviewId)) return { ok: false, error: scorecardMessage("not_found") };
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await submitScorecard(auth.supabase, interviewId);
  if (result.ok) {
    // The kit is a layout with sections; the scorecard is one of them.
    revalidatePath(`/company/interviews/${interviewId}`, "layout");
    revalidatePath("/company/my-interviews");
    revalidatePath(applicationPath(result.applicationId), "layout");
  }
  return result;
}
