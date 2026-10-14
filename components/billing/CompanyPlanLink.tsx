import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

export type PlanSummary = { name: string; slug: string; credits: number } | null;

/** "Plan: Startup · 1,240 credits", linking to /company/billing (§4.4). */
const CompanyPlanLink = forwardRef<
  HTMLAnchorElement,
  { plan: PlanSummary } & Omit<ComponentPropsWithoutRef<typeof Link>, "href">
>(function CompanyPlanLink({ plan, className, ...props }, ref) {
  return (
    <Link ref={ref} href="/company/billing" className={className} {...props}>
      {plan
        ? `Plan: ${plan.name} · ${Number(plan.credits ?? 0).toLocaleString("en-US")} credits`
        : "Plan and billing"}{" "}
      <span className="underline font-medium text-foreground">Manage</span>
    </Link>
  );
});

export default CompanyPlanLink;
