import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import BillingOverview from "@/components/billing/BillingOverview";
import ErrorComponent from "@/components/Error";

export const dynamic = "force-dynamic";

// BL-REQ-010. The company comes from the session; billing state is read with the
// service role after that (company_subscriptions etc. are member-readable anyway).
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

  const { data: company } = await supabase
    .from("company_info")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!company) redirect("/get-started?company=true");

  const params = await searchParams;

  try {
    const service = createServiceRoleClient();
    const [billing, plans, packs, history] = await Promise.all([
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
    ]);

    return (
      <BillingOverview
        billing={billing}
        plans={plans}
        packs={packs.data ?? []}
        history={history.data ?? []}
        highlightPlan={params.plan ?? null}
        checkoutDone={params.checkout === "done"}
      />
    );
  } catch (err) {
    console.error("[billing] page", err);
    return <ErrorComponent />;
  }
}
