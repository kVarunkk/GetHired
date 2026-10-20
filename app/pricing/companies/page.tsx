import type { Metadata } from "next";
import PlanCards from "@/components/billing/PlanCards";
import PricingViewed from "@/components/billing/PricingViewed";
import Footer from "@/components/landing-page/Footer";
import { listPublicPlans, type Plan } from "@/helpers/billing/plans";

export const metadata: Metadata = {
  title: "Pricing for Companies",
  description:
    "Start hiring free on GetHired. Paid plans add more job posts, AI screening, outreach and AI interviews.",
  alternates: { canonical: "/pricing/companies" },
};

// Plans are cached under the billing-plans tag; the page itself every hour.
export const revalidate = 3600;

export default async function CompanyPricingPage() {
  let plans: Plan[] = [];
  try {
    plans = await listPublicPlans();
  } catch (err) {
    console.error("[pricing] couldn't load plans", err);
  }

  return (
    <main className="flex min-h-screen flex-col">
      <PricingViewed />
      <div className="flex w-full flex-col gap-8 px-4 py-12 lg:px-20 xl:px-40">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">Pricing for companies</h1>
          <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
            Post a job, see matched candidates and screen applicants for free. Paid plans add volume, team seats and
            AI interviews. Usage beyond your plan&apos;s allowances is paid with credits.
          </p>
        </div>
        {plans.length > 0 ? (
          <PlanCards plans={plans} />
        ) : (
          <p className="text-sm text-muted-foreground">Plans couldn&apos;t be loaded. Please try again shortly.</p>
        )}
      </div>
      <Footer />
    </main>
  );
}
