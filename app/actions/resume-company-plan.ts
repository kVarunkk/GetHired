"use server";

import { reportError } from "@/helpers/posthog/report-error";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BILLING_FORBIDDEN, canManageBilling } from "@/helpers/billing/access";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { cancelAtPeriodEnd } from "@/helpers/billing/dodo";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

type Result = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: undoes a cancellation before the period ends. */
export async function resumeCompanyPlanAction(): Promise<Result> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user, company } = auth;
  if (!canManageBilling(user, company)) return { ok: false, error: BILLING_FORBIDDEN };

  const sub = await getCompanySubscription(company.id);
  if (!sub?.dodoSubscriptionId || !sub.cancelAtPeriodEnd) {
    return { ok: false, error: "Your plan isn't set to cancel." };
  }

  try {
    await cancelAtPeriodEnd(sub.dodoSubscriptionId, false);
  } catch (err) {
    reportError("[billing] resume failed", err);
    return { ok: false, error: "Couldn't resume your plan. Please try again." };
  }

  const { error } = await createServiceRoleClient().rpc("set_company_cancel_at_period_end", {
    p_company_id: company.id,
    p_cancel: false,
  });
  if (error) reportError("[billing] couldn't record the resume", error);

  await eventCaptureServer({
    event: PostHogEvent.BillingResumed,
    distinctId: company.id,
    properties: { companyId: company.id },
  });
  return { ok: true };
}
