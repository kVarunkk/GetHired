"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { BILLING_FORBIDDEN, canManageBilling } from "@/helpers/billing/access";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { customerPortalUrl } from "@/helpers/billing/dodo";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { deploymentUrl } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";

type Result = { ok: true; url: string } | { ok: false; error: string };

/** SERVER ACTION (BL-REQ-010): payment method and invoices, in Dodo's portal. */
export async function openBillingPortalAction(): Promise<Result> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user, company } = auth;
  if (!canManageBilling(user, company)) return { ok: false, error: BILLING_FORBIDDEN };

  const sub = await getCompanySubscription(company.id);
  if (!sub?.dodoCustomerId) {
    return { ok: false, error: "There's no payment method on file yet." };
  }

  try {
    const url = await customerPortalUrl(sub.dodoCustomerId, `${deploymentUrl()}/company/billing`);
    await eventCaptureServer({
      event: PostHogEvent.BillingPortalOpened,
      distinctId: company.id,
      properties: { companyId: company.id },
    });
    return { ok: true, url };
  } catch (err) {
    console.error("[billing] portal failed", err);
    return { ok: false, error: "Couldn't open the billing portal. Please try again." };
  }
}
