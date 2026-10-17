import { NextResponse } from "next/server";
import { requireCompany } from "@/helpers/companies/require-company";
import { getEntitlements } from "@/helpers/billing/entitlements";

// BL-REQ-010: the session company's plan, usage and credits. The company always
// comes from the session; any companyId in the query is ignored.
export async function GET() {
  const auth = await requireCompany({ permission: "billing.view" });
  if (!auth.ok) return auth.response;

  try {
    const e = await getEntitlements(auth.company.id);
    return NextResponse.json({
      plan: e.tier,
      status: e.status,
      period: e.period,
      billingInterval: e.billingInterval,
      entitlements: e.entitlements,
      creditBalance: e.creditBalance,
      creditLots: e.creditLots,
      cancelAtPeriodEnd: e.cancelAtPeriodEnd,
      scheduledPlan: e.scheduledTierSlug,
      graceUntil: e.graceUntil,
      manualUntil: e.manualUntil,
      hasPaidSubscription: e.hasPaidSubscription,
    });
  } catch (err) {
    console.error("[billing] GET /api/company/billing", err);
    return NextResponse.json({ error: "Couldn't load billing." }, { status: 500 });
  }
}
