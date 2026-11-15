"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { applicationPath } from "@/helpers/applications/application-page";
import { toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { generateFeedbackSummary, type FeedbackSummaryView } from "@/helpers/interviews/feedback-summary";

/**
 * SERVER ACTION (IVT-081, IV-REQ-051): summarizes the panel's submitted
 * scorecards for an application. Needs `scorecards.view_all`; the RPCs check
 * it for the application's job. Costs one agent message.
 */
export async function summarizeFeedbackAction({
  applicationId,
}: {
  applicationId: string;
}): Promise<{ ok: true; view: FeedbackSummaryView } | { ok: false; error: string } | EntitlementActionError> {
  if (!isUuid(applicationId)) return { ok: false, error: "Application not found." };
  const auth = await requireCompanyForAction({ permission: "scorecards.view_all" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await generateFeedbackSummary(auth.supabase, {
    companyId: auth.company.id,
    userId: auth.user.id,
    applicationId,
  });
  if (!result.ok) return "entitlement" in result ? toEntitlementActionError(result.entitlement) : result;
  revalidatePath(applicationPath(applicationId), "layout");
  return result;
}
