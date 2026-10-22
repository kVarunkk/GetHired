"use server";

import { reportError } from "@/helpers/posthog/report-error";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BILLING_FORBIDDEN, canManageBilling } from "@/helpers/billing/access";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { cancelAtPeriodEnd } from "@/helpers/billing/dodo";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

type Result = { ok: true; endsAt: string } | { ok: false; error: string };

/** SERVER ACTION (BL-REQ-012): the plan stays until the period ends, then Free. */
export async function cancelCompanyPlanAction(): Promise<Result> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user, company } = auth;
  if (!canManageBilling(user, company)) return { ok: false, error: BILLING_FORBIDDEN };

  const sub = await getCompanySubscription(company.id);
  if (!sub?.dodoSubscriptionId) return { ok: false, error: "You don't have a paid plan to cancel." };
  if (sub.cancelAtPeriodEnd) return { ok: true, endsAt: sub.currentPeriodEnd };

  try {
    await cancelAtPeriodEnd(sub.dodoSubscriptionId, true);
  } catch (err) {
    reportError("[billing] cancel failed", err);
    return { ok: false, error: "Couldn't cancel your plan. Please try again." };
  }

  const { error } = await createServiceRoleClient().rpc("set_company_cancel_at_period_end", {
    p_company_id: company.id,
    p_cancel: true,
  });
  if (error) reportError("[billing] couldn't record the cancellation", error);

  await eventCaptureServer({
    event: PostHogEvent.BillingCancelled,
    distinctId: company.id,
    properties: { companyId: company.id },
  });
  return { ok: true, endsAt: sub.currentPeriodEnd };
}
