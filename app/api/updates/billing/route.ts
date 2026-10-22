import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { getEntitlements, type CompanyEntitlements } from "@/helpers/billing/entitlements";
import {
  billingContactsFor,
  sendCreditsExpiringEmail,
  sendPaymentFailedEmail,
  sendUsageThresholdEmail,
  type BillingContacts,
} from "@/helpers/billing/emails";
import {
  BL_CREDIT_EXPIRY_WARNING_DAYS,
  BL_GRACE_DAYS,
  BL_GRACE_EMAIL_DAYS,
} from "@/helpers/billing/config";
import { KEY_LABELS, isEntitlementKey } from "@/helpers/billing/keys";

const DAY_MS = 86_400_000;

type Report = {
  rolledOver: number;
  expiredGrants: number;
  graceEnded: number;
  paidEnded: number;
  expiredLots: number;
  releasedHolds: number;
  notified: number;
  graceEmails: number;
  expiryWarnings: number;
  failures: string[];
};

/**
 * Daily billing cron (§4.1), called by the scheduler with X-Internal-Secret:
 * rollover_free_periods, the 80%/100% usage emails (BL-REQ-022), the grace
 * emails on days 0, 3 and 6 (BL-REQ-013) and credit expiry warnings. A failing
 * email doesn't stop the run; failures are reported by status email.
 */
export async function POST(req: NextRequest) {
  if (!INTERNAL_API_SECRET || req.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized access" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  try {
    const { data: rolled, error: rollError } = await supabase.rpc("rollover_free_periods");
    if (rollError) throw new Error(`rollover_free_periods: ${rollError.message}`);

    const report: Report = {
      rolledOver: 0,
      expiredGrants: 0,
      graceEnded: 0,
      paidEnded: 0,
      expiredLots: 0,
      releasedHolds: 0,
      ...(rolled as Partial<Report>),
      notified: 0,
      graceEmails: 0,
      expiryWarnings: 0,
      failures: [],
    };

    const contacts = new Map<string, Promise<BillingContacts>>();
    const contactsOf = (companyId: string) => {
      if (!contacts.has(companyId)) contacts.set(companyId, billingContactsFor(companyId));
      return contacts.get(companyId)!;
    };
    const entitlements = new Map<string, Promise<CompanyEntitlements>>();
    const entitlementsOf = (companyId: string) => {
      if (!entitlements.has(companyId)) entitlements.set(companyId, getEntitlements(companyId));
      return entitlements.get(companyId)!;
    };

    // 1. Usage at 80% / 100%, once per key per period.
    const { data: alerts, error: alertsError } = await supabase.rpc("billing_usage_alerts");
    if (alertsError) throw new Error(`billing_usage_alerts: ${alertsError.message}`);
    for (const alert of alerts ?? []) {
      if (!isEntitlementKey(alert.key)) continue;
      try {
        const [{ companyName, emails }, e] = await Promise.all([
          contactsOf(alert.company_id),
          entitlementsOf(alert.company_id),
        ]);
        await sendUsageThresholdEmail(emails, {
          companyName,
          label: KEY_LABELS[alert.key].many,
          used: alert.used,
          amount: alert.amount,
          threshold: alert.threshold >= 100 ? 100 : 80,
          resetsAt: e.period.end,
          canUseCredits: e.entitlements[alert.key].overageCredits !== null,
        });
        const { error } = await supabase.rpc("mark_usage_notified", {
          p_company_id: alert.company_id,
          p_period_start: alert.period_start,
          p_key: alert.key,
          p_threshold: alert.threshold,
        });
        if (error) throw new Error(`mark_usage_notified: ${error.message}`);
        report.notified += 1;
      } catch (err) {
        reportError("[billing cron] usage alert failed", err);
        report.failures.push(`usage ${alert.company_id}/${alert.key}: ${message(err)}`);
      }
    }

    // 2. Grace period emails on days 0, 3 and 6.
    const now = Date.now();
    const { data: pastDue, error: pastDueError } = await supabase
      .from("company_subscriptions")
      .select("company_id, grace_until")
      .eq("status", "past_due")
      .gt("grace_until", new Date(now).toISOString());
    if (pastDueError) throw new Error(`past_due: ${pastDueError.message}`);
    for (const sub of pastDue ?? []) {
      if (!sub.grace_until) continue;
      const graceStart = new Date(sub.grace_until).getTime() - BL_GRACE_DAYS * DAY_MS;
      const day = Math.floor((now - graceStart) / DAY_MS);
      if (!BL_GRACE_EMAIL_DAYS.includes(day)) continue;
      try {
        const [{ companyName, emails }, e] = await Promise.all([
          contactsOf(sub.company_id),
          entitlementsOf(sub.company_id),
        ]);
        await sendPaymentFailedEmail(emails, {
          companyName,
          planName: e.tier.name,
          graceUntil: sub.grace_until,
        });
        report.graceEmails += 1;
      } catch (err) {
        reportError("[billing cron] grace email failed", err);
        report.failures.push(`grace ${sub.company_id}: ${message(err)}`);
      }
    }

    // 3. Credits expiring in 30 days: the lots that enter the window today.
    const windowEnd = new Date(now + BL_CREDIT_EXPIRY_WARNING_DAYS * DAY_MS);
    const windowStart = new Date(windowEnd.getTime() - DAY_MS);
    const { data: lots, error: lotsError } = await supabase
      .from("company_credit_ledger")
      .select("company_id, remaining, expires_at")
      .gt("remaining", 0)
      .gte("expires_at", windowStart.toISOString())
      .lt("expires_at", windowEnd.toISOString());
    if (lotsError) throw new Error(`expiring lots: ${lotsError.message}`);
    const expiring = new Map<string, { credits: number; expiresAt: string }>();
    for (const lot of lots ?? []) {
      const prev = expiring.get(lot.company_id);
      expiring.set(lot.company_id, {
        credits: (prev?.credits ?? 0) + (lot.remaining ?? 0),
        expiresAt: prev && prev.expiresAt < lot.expires_at! ? prev.expiresAt : lot.expires_at!,
      });
    }
    for (const [companyId, { credits, expiresAt }] of expiring) {
      try {
        const { companyName, emails } = await contactsOf(companyId);
        await sendCreditsExpiringEmail(emails, { companyName, credits, expiresAt });
        report.expiryWarnings += 1;
      } catch (err) {
        reportError("[billing cron] expiry email failed", err);
        report.failures.push(`expiry ${companyId}: ${message(err)}`);
      }
    }

    await sendEmailForStatusUpdate(
      `BILLING CRON: ${JSON.stringify({ ...report, failures: report.failures.length })}` +
        (report.failures.length ? `\nFailures:\n${report.failures.join("\n")}` : ""),
    );

    return NextResponse.json(report);
  } catch (err) {
    reportError("[billing cron] critical failure", err);
    await sendEmailForStatusUpdate(`BILLING CRON CRITICAL FAILURE:\n${message(err)}`);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

/** The scheduler's other crons use GET; accept both. */
export const GET = POST;

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
