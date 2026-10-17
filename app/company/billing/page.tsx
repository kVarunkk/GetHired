import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { canManageBilling, canViewBilling } from "@/helpers/billing/access";
import { listMemberUsage } from "@/helpers/billing/member-usage";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import BillingOverview from "@/components/billing/BillingOverview";
import ErrorComponent from "@/components/Error";

export const dynamic = "force-dynamic";

// BL-REQ-010. The company comes from the session; billing state is read with the
// service role after that (company_subscriptions etc. are member-readable anyway).
// RP-DEC-003: billing.view sees it, only owners manage it.
export default async function CompanyBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; checkout?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?company=true");

  const company = await getMyCompany(supabase, user);
  if (!company) redirect("/get-started?company=true");
  if (!canViewBilling(company)) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4">
        <div className="rounded-lg border p-6">
          <p className="font-semibold">Billing</p>
          <p className="mt-1 text-sm text-muted-foreground">{forbiddenMessage("billing.view")}</p>
        </div>
      </div>
    );
  }

  const params = await searchParams;

  try {
    const service = createServiceRoleClient();
    const canManage = canManageBilling(user, company);
    const [billing, plans, packs, history, memberUsage] = await Promise.all([
      getEntitlements(company.id),
      listPublicPlans(),
      // Company packs aren't readable by users (only applicant packs are).
      service
        .from("price_plan")
        .select("id, name, description, credit_amount, amount, currency, product_id")
        .eq("audience", "company")
        .order("credit_amount", { ascending: true }),
      service
        .from("payments")
        .select("id, kind, status, total_amount, currency, credit_amount, created_at")
        .eq("company_id", company.id)
        .neq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20),
      // RP-REQ-044. The user's client: member_usage checks billing.view itself.
      listMemberUsage(supabase),
    ]);

    return (
      <BillingOverview
        billing={billing}
        plans={plans}
        packs={packs.data ?? []}
        history={history.data ?? []}
        highlightPlan={params.plan ?? null}
        checkoutDone={params.checkout === "done"}
        canManage={canManage}
        memberUsage={memberUsage}
      />
    );
  } catch (err) {
    console.error("[billing] page", err);
    return <ErrorComponent />;
  }
}
