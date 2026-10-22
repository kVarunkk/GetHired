"use server";

import { reportError } from "@/helpers/posthog/report-error";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BILLING_FORBIDDEN, canManageBilling } from "@/helpers/billing/access";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { getPlanBySlug, listPublicPlans, priceFor } from "@/helpers/billing/plans";
import { changePlan } from "@/helpers/billing/dodo";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

type Result = { ok: true; scheduled: boolean } | { ok: false; error: string };

/**
 * SERVER ACTION (BL-REQ-011): moves the session company's paid subscription to
 * another public plan. Upgrades apply now with proration and our state follows
 * from the subscription.plan_changed webhook. Downgrades apply at the period end:
 * Dodo is told to switch then, and scheduled_tier_id records it here.
 */
export async function changeCompanyPlanAction({ tierSlug }: { tierSlug: string }): Promise<Result> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user, company } = auth;
  if (!canManageBilling(user, company)) return { ok: false, error: BILLING_FORBIDDEN };

  if (typeof tierSlug !== "string" || tierSlug === "free") {
    return { ok: false, error: "To move to Free, cancel your plan." };
  }

  const [target, current, sub] = await Promise.all([
    getPlanBySlug(tierSlug),
    getEntitlements(company.id),
    getCompanySubscription(company.id),
  ]);
  if (!target) return { ok: false, error: "That plan isn't available." };
  if (!sub?.dodoSubscriptionId || current.status === "expired") {
    return { ok: false, error: "Choose a plan to subscribe first." };
  }
  if (current.subscribedTierSlug === target.slug) {
    return { ok: false, error: `You're already on ${target.name}.` };
  }

  const price = priceFor(target, sub.billingInterval ?? "month", sub.currency ?? "USD");
  if (!price?.dodo_product_id) return { ok: false, error: "That plan isn't available for your billing." };

  const plans = await listPublicPlans();
  const currentSort = plans.find((p) => p.slug === current.subscribedTierSlug)?.sort ?? 0;
  const isUpgrade = target.sort > currentSort;

  try {
    await changePlan(sub.dodoSubscriptionId, price.dodo_product_id, {
      prorate: isUpgrade,
      atPeriodEnd: !isUpgrade,
    });
  } catch (err) {
    reportError("[billing] change plan failed", err);
    return { ok: false, error: "Couldn't change your plan. Please try again." };
  }

  if (!isUpgrade) {
    const { error } = await createServiceRoleClient().rpc("schedule_company_plan_change", {
      p_company_id: company.id,
      p_tier_slug: target.slug,
    });
    if (error) reportError("[billing] couldn't record the scheduled downgrade", error);
  }

  await eventCaptureServer({
    event: PostHogEvent.BillingPlanChanged,
    distinctId: company.id,
    properties: { companyId: company.id, from: current.subscribedTierSlug, to: target.slug, scheduled: !isUpgrade },
  });
  return { ok: true, scheduled: !isUpgrade };
}
