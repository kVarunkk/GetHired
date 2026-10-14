"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/utils";
import { KEY_LABELS, type EntitlementKey } from "@/helpers/billing/keys";
import {
  formatPrice,
  priceFor,
  type BillingCurrency,
  type BillingInterval,
  type Plan,
} from "@/helpers/billing/plans";

/** The keys shown on each card, in order. */
const SHOWN_KEYS: EntitlementKey[] = [
  "active_job_posts",
  "seats",
  "profiles_per_search",
  "screenings",
  "outreach",
  "interview_minutes",
  "agent_messages",
];

export const SIGNUP_HREF = "/auth/sign-up?company=true";
export const ENTERPRISE_HREF = "mailto:varun@devhub.co.in?subject=GetHired%20Enterprise";

type PlanCardsProps = {
  plans: Plan[];
  /** The company's plan; omitted on the public pricing page. */
  currentSlug?: string | null;
  /** Billing page: start a checkout or change plan. Without it, buttons link to signup. */
  onSelect?: (slug: string, interval: BillingInterval, currency: BillingCurrency) => void;
  /** The plan to highlight (`?plan=` from an upgrade prompt). */
  highlightSlug?: string | null;
  defaultCurrency?: BillingCurrency;
  busySlug?: string | null;
};

function amountLine(plan: Plan, key: EntitlementKey) {
  const e = plan.entitlements[key];
  if (!e) return null;
  const label = KEY_LABELS[key].many;
  if (e.amount === null) return `∞ ${label}`;
  const perMonth = e.kind === "allowance" ? " / month" : "";
  return `${e.amount.toLocaleString("en-US")} ${label}${perMonth}`;
}

export default function PlanCards({
  plans,
  currentSlug = null,
  onSelect,
  highlightSlug = null,
  defaultCurrency = "USD",
  busySlug = null,
}: PlanCardsProps) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [currency, setCurrency] = useState<BillingCurrency>(defaultCurrency);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Billing interval" className="inline-flex rounded-lg border p-0.5">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                interval === i ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i === "month" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Currency" className="inline-flex rounded-lg border p-0.5">
          {(["USD", "INR"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => setCurrency(c)}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                currency === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const price = priceFor(plan, interval, currency);
          const isCurrent = plan.slug === currentSlug;
          const isFree = plan.slug === "free";
          const isCustom = !isFree && plan.prices.length === 0;
          const highlighted = plan.slug === highlightSlug && !isCurrent;

          let action: React.ReactNode;
          if (isCurrent) {
            action = (
              <Button variant="outline" disabled className="w-full">
                Current plan
              </Button>
            );
          } else if (isCustom) {
            action = (
              <Button asChild variant="outline" className="w-full">
                <a href={ENTERPRISE_HREF}>Contact us</a>
              </Button>
            );
          } else if (!onSelect) {
            action = (
              <Button asChild variant={highlighted ? "brand" : "outline"} className="w-full">
                <Link href={SIGNUP_HREF}>{isFree ? "Start free" : `Start with ${plan.name}`}</Link>
              </Button>
            );
          } else if (isFree) {
            action = null;
          } else {
            action = (
              <Button
                variant={highlighted ? "brand" : "outline"}
                className="w-full"
                disabled={!price?.dodo_product_id || busySlug !== null}
                onClick={() => onSelect(plan.slug, interval, currency)}
              >
                {busySlug === plan.slug ? "Opening…" : `Choose ${plan.name}`}
              </Button>
            );
          }

          return (
            <li
              key={plan.id}
              aria-label={plan.name}
              className={cn(
                "flex flex-col gap-4 rounded-xl border p-5",
                highlighted && "border-brand/40 bg-brandSoft",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                {isCurrent && <Badge variant="brand">Current</Badge>}
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {isFree ? formatPrice({ amount_minor: 0, currency }) : isCustom ? "Custom" : price ? formatPrice(price) : "—"}
                </p>
                {!isFree && !isCustom && (
                  <p className="text-xs font-medium text-muted-foreground">per {interval === "month" ? "month" : "year"}</p>
                )}
              </div>
              {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
              <ul className="flex flex-col gap-1.5 text-sm">
                {SHOWN_KEYS.map((key) => {
                  const line = amountLine(plan, key);
                  return line ? (
                    <li key={key} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{line}</span>
                    </li>
                  ) : null;
                })}
              </ul>
              <div className="mt-auto">{action}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
