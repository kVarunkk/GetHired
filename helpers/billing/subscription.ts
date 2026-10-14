import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type CompanySubscription = {
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  billingInterval: "month" | "year" | null;
  currency: "USD" | "INR" | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
};

/** The Dodo side of a company's subscription. Call after requireCompany(). */
export async function getCompanySubscription(companyId: string): Promise<CompanySubscription | null> {
  const { data, error } = await createServiceRoleClient()
    .from("company_subscriptions")
    .select(
      "dodo_subscription_id, dodo_customer_id, billing_interval, currency, status, cancel_at_period_end, current_period_end",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the subscription: ${error.message}`);
  if (!data) return null;
  return {
    dodoSubscriptionId: data.dodo_subscription_id,
    dodoCustomerId: data.dodo_customer_id,
    billingInterval: data.billing_interval as CompanySubscription["billingInterval"],
    currency: data.currency as CompanySubscription["currency"],
    status: data.status,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    currentPeriodEnd: data.current_period_end,
  };
}
