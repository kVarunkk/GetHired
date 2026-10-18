"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, CreditCard, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/DataTable";
import { ALLOWANCE_KEYS, ENTITLEMENT_KEYS, KEY_LABELS, type EntitlementKey } from "@/helpers/billing/keys";
import type { CompanyEntitlements } from "@/helpers/billing/entitlements";
import CreditCostList from "@/components/CreditCostList";
import { companyCreditCosts } from "@/utils/credit-costs";
import {
  formatPrice,
  priceFor,
  type BillingCurrency,
  type BillingInterval,
  type Plan,
} from "@/helpers/billing/plans";
import { changeCompanyPlanAction } from "@/app/actions/change-company-plan";
import { cancelCompanyPlanAction } from "@/app/actions/cancel-company-plan";
import { resumeCompanyPlanAction } from "@/app/actions/resume-company-plan";
import { openBillingPortalAction } from "@/app/actions/open-billing-portal";
import type { MemberUsageRow } from "@/helpers/billing/member-usage";
import { BILLING_FORBIDDEN } from "@/helpers/billing/access";
import PlanCards from "./PlanCards";
import MemberUsage from "./MemberUsage";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutBilling } from "@/components/agent/recruiter/AskAgentOnMainPages";

export type CreditPack = {
  id: string;
  name: string | null;
  description: string | null;
  credit_amount: number | null;
  amount: number | null;
  currency: string | null;
  product_id: string | null;
};

export type BillingHistoryRow = {
  id: string;
  kind: string;
  status: string;
  total_amount: number | null;
  currency: string | null;
  credit_amount: number | null;
  created_at: string;
};

type BillingOverviewProps = {
  billing: CompanyEntitlements;
  plans: Plan[];
  packs: CreditPack[];
  history: BillingHistoryRow[];
  highlightPlan?: string | null;
  checkoutDone?: boolean;
  /** Owners manage billing; anyone else with billing.view sees it read-only (RP-DEC-003). */
  canManage?: boolean;
  /** Per-member usage (RP-REQ-044); null when it couldn't be read. */
  memberUsage?: MemberUsageRow[] | null;
  /** agent.use: shows the usage helper under the header. */
  canUseAgent?: boolean;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const HISTORY_COLUMNS: ColumnDef<BillingHistoryRow>[] = [
  {
    id: "date",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.created_at),
    meta: { className: "text-muted-foreground" },
  },
  {
    id: "item",
    header: "Item",
    cell: ({ row }) =>
      row.original.kind === "company_subscription" ? "Subscription" : `${row.original.credit_amount ?? ""} credits`,
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) =>
      row.original.total_amount !== null
        ? `${(row.original.total_amount / 100).toFixed(2)} ${row.original.currency}`
        : "-",
    meta: { className: "text-right tabular-nums", headerClassName: "text-right" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.status === "complete" ? "success" : row.original.status === "failed" ? "destructive" : "secondary"
        }
      >
        {row.original.status}
      </Badge>
    ),
  },
];

/** What a confirm dialog is about to do. */
type PendingChange = {
  key: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "brand" | "destructive";
  onConfirm: () => Promise<void>;
};

const STATUS_LABEL: Record<CompanyEntitlements["status"], string> = {
  active: "Active",
  past_due: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

function UsageRow({ entitlementKey, billing }: { entitlementKey: EntitlementKey; billing: CompanyEntitlements }) {
  const e = billing.entitlements[entitlementKey];
  const label = KEY_LABELS[entitlementKey].many;
  const unlimited = e.amount === null;
  const used = e.used + (e.kind === "allowance" ? e.held : 0);
  const over = !unlimited && e.kind === "limit" && entitlementKey !== "profiles_per_search" && e.used > (e.amount ?? 0);
  const percent = unlimited || !e.amount ? 0 : Math.min(100, Math.round((used / e.amount) * 100));

  let value: string;
  if (entitlementKey === "profiles_per_search") value = unlimited ? "∞" : `${e.amount}`;
  else value = unlimited ? `${used.toLocaleString("en-US")} of ∞` : `${used.toLocaleString("en-US")} of ${e.amount!.toLocaleString("en-US")}`;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="capitalize">
          {label}
          {e.kind === "allowance" && <span className="text-muted-foreground"> / month</span>}
        </span>
        <span className="font-medium tabular-nums" data-testid={`usage-${entitlementKey}`}>
          {value}
        </span>
      </div>
      {!unlimited && entitlementKey !== "profiles_per_search" && (
        <Progress value={percent} aria-label={`${label} used`} className="h-1.5 bg-muted" />
      )}
      {over && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {e.used} of {e.amount} {label}: close one to {entitlementKey === "seats" ? "invite more" : "publish more"}.
        </p>
      )}
    </li>
  );
}

/** BL-REQ-010: plan, usage, credits, plan changes and billing history. */
export default function BillingOverview({
  billing,
  plans,
  packs,
  history,
  highlightPlan = null,
  checkoutDone = false,
  canManage = true,
  memberUsage = null,
  canUseAgent = false,
}: BillingOverviewProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Kept after closing so the text doesn't blank out during the fade.
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function ask(change: PendingChange) {
    setPending(change);
    setDialogOpen(true);
  }

  useEffect(() => {
    if (checkoutDone) toast.success("Thanks! Your purchase will show here in a moment.");
  }, [checkoutDone]);

  useEffect(() => {
    if (highlightPlan) document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" });
  }, [highlightPlan]);

  async function checkout(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/company/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start the checkout.");
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the checkout.");
      setBusy(null);
    }
  }

  async function run<T extends { ok: boolean; error?: string }>(key: string, action: () => Promise<T>, done: (r: T) => void) {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      done(result);
      router.refresh();
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const renewsAt = billing.manualUntil ?? (billing.hasPaidSubscription ? billing.renewsAt : null);

  /** "$149 / month", for the plan on the subscription's own interval and currency. */
  function priceLabel(plan: Plan, interval: BillingInterval, currency: BillingCurrency) {
    const price = priceFor(plan, interval, currency);
    return price ? `${formatPrice(price)} / ${interval}` : null;
  }

  function selectPlan(slug: string, interval: BillingInterval, currency: BillingCurrency) {
    if (!billing.hasPaidSubscription || billing.status === "expired") {
      // A new subscription: Dodo's checkout is the confirmation.
      void checkout({ kind: "subscription", tierSlug: slug, interval, currency }, slug);
      return;
    }

    // A change to a paid subscription charges the saved card, so confirm first.
    const target = plans.find((p) => p.slug === slug);
    if (!target) return;
    const currentSlug = billing.subscribedTierSlug ?? billing.tier.slug;
    const current = plans.find((p) => p.slug === currentSlug);
    const isUpgrade = target.sort > (current?.sort ?? 0);
    const subInterval = billing.billingInterval ?? interval;
    const subCurrency = (billing.currency as BillingCurrency | null) ?? currency;
    const price = priceLabel(target, subInterval, subCurrency);
    const date = formatDate(billing.renewsAt);
    const currentName = current?.name ?? billing.tier.name;

    ask(
      isUpgrade
        ? {
            key: slug,
            title: `Switch to ${target.name} now?`,
            description:
              `${target.name} starts today. You'll be charged the prorated difference for the rest of this period on your saved payment method` +
              (price ? `, then ${price} from ${date}.` : "."),
            confirmLabel: `Switch to ${target.name}`,
            variant: "brand",
            onConfirm: () =>
              run(slug, () => changeCompanyPlanAction({ tierSlug: slug }), () =>
                toast.success(`Switching to ${target.name}. It may take a moment to show here.`),
              ),
          }
        : {
            key: slug,
            title: `Switch to ${target.name} on ${date}?`,
            description:
              `You keep ${currentName} until ${date}, then move to ${target.name}` +
              (price ? ` at ${price}` : "") +
              `. Nothing is deleted; anything over ${target.name}'s limits stays but can't grow.`,
            confirmLabel: "Schedule change",
            variant: "brand",
            onConfirm: () =>
              run(slug, () => changeCompanyPlanAction({ tierSlug: slug }), () =>
                toast.success(`You'll move to ${target.name} on ${date}.`),
              ),
          },
    );
  }

  function confirmCancel() {
    const date = formatDate(billing.renewsAt);
    ask({
      key: "cancel",
      title: `Cancel ${billing.tier.name}?`,
      description: `${billing.tier.name} stays active until ${date}, then your company moves to Free. You won't be charged again, and you can resume before then.`,
      confirmLabel: "Cancel plan",
      variant: "destructive",
      onConfirm: () =>
        run("cancel", cancelCompanyPlanAction, () => toast.success(`Your plan will end on ${date}.`)),
    });
  }

  const scheduledPlan = billing.scheduledTierSlug
    ? (plans.find((p) => p.slug === billing.scheduledTierSlug)?.name ?? billing.scheduledTierSlug)
    : null;

  return (
    <div className="flex w-full flex-col gap-8 p-4 mb-20">
      <PageHeader title="Billing" description="Your plan, usage and credits." />

      {canUseAgent && <AskAgentAboutBilling />}

      {billing.status === "past_due" && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            We couldn&apos;t take your last payment. Your plan keeps working until{" "}
            {billing.graceUntil ? formatDate(billing.graceUntil) : "the end of the grace period"}. Update your payment
            method to keep it.
          </span>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Current plan</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">{billing.tier.name}</span>
            <Badge variant={billing.status === "active" ? "secondary" : "destructive"}>{STATUS_LABEL[billing.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {billing.cancelAtPeriodEnd
              ? `Cancels on ${formatDate(billing.renewsAt)}. You'll move to Free then.`
              : billing.manualUntil
                ? `Until ${formatDate(billing.manualUntil)}.`
                : renewsAt
                  ? `Renews on ${formatDate(renewsAt)}.`
                  : `Usage resets on ${formatDate(billing.period.end)}.`}
            {scheduledPlan && ` Moves to ${scheduledPlan} at the end of this period.`}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {billing.cancelAtPeriodEnd && billing.hasPaidSubscription && (
              <Button
                variant="brand"
                disabled={busy !== null}
                onClick={() => run("resume", resumeCompanyPlanAction, () => toast.success("Your plan will renew."))}
              >
                Resume
              </Button>
            )}
            {billing.hasBillingPortal && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("portal", openBillingPortalAction, (r) => window.open((r as { url: string }).url, "_blank", "noopener"))
                }
              >
                <CreditCard className="h-4 w-4" />
                Payment method and invoices
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            {billing.hasPaidSubscription && !billing.cancelAtPeriodEnd && (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={confirmCancel}
              >
                Cancel plan
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{BILLING_FORBIDDEN}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Usage this month</h3>
        <ul className="divide-y rounded-xl border">
          {ENTITLEMENT_KEYS.map((key) => (
            <UsageRow key={key} entitlementKey={key} billing={billing} />
          ))}
        </ul>
      </section>

      {memberUsage && memberUsage.length > 0 && <MemberUsage rows={memberUsage} />}

      <section id="credits" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-lg font-semibold tracking-tight">Credits</h3>
          <span className="text-sm">
            <span className="font-medium tabular-nums">{billing.creditBalance.toLocaleString("en-US")}</span>{" "}
            <span className="text-muted-foreground">available</span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Credits pay for usage beyond your monthly allowances. They&apos;re used oldest first and expire 12 months after
          purchase.
        </p>
        <h4 className="text-sm font-semibold">What uses your allowances and credits</h4>
        <CreditCostList
          label="What uses your allowances and credits"
          costs={companyCreditCosts(
            Object.fromEntries(ALLOWANCE_KEYS.map((key) => [key, billing.entitlements[key]?.overageCredits])),
          )}
        />
        {billing.creditLots.length > 0 && (
          <ul className="divide-y rounded-xl border" aria-label="Credit lots">
            {billing.creditLots.map((lot) => (
              <li key={lot.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="tabular-nums">{lot.remaining.toLocaleString("en-US")} credits</span>
                <span className="text-muted-foreground">
                  {lot.expiresAt ? `Expires ${formatDate(lot.expiresAt)}` : "No expiry"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canManage && packs.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {packs.map((pack) => (
              <div key={pack.id} className="flex flex-col gap-3 rounded-xl border p-4">
                <div>
                  <p className="font-medium">{pack.credit_amount?.toLocaleString("en-US")} credits</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.currency}
                    {pack.amount}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={!pack.product_id || busy !== null}
                  onClick={() => checkout({ kind: "credits", pricePlanId: pack.id }, pack.id)}
                >
                  {busy === pack.id ? "Opening…" : "Buy"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage && (
        <section id="plans" className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold tracking-tight">Plans</h3>
          <PlanCards
            plans={plans}
            currentSlug={billing.subscribedTierSlug ?? billing.tier.slug}
            onSelect={selectPlan}
            highlightSlug={highlightPlan}
            defaultCurrency={billing.currency === "INR" ? "INR" : "USD"}
            busySlug={busy}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Billing history</h3>
        <DataTable
          aria-label="Billing history"
          data={history}
          columns={HISTORY_COLUMNS}
          noun="payments"
          emptyMessage="No payments yet."
          getRowId={(row) => row.id}
        />
      </section>
      <AlertDialog open={dialogOpen} onOpenChange={(open) => !confirming && setDialogOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-semibold tracking-tight">{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[15px] leading-7">{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Keep my plan</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: pending?.variant ?? "brand" })}
              disabled={confirming}
              onClick={async (e) => {
                // Stay open until the change is done, instead of closing on click.
                e.preventDefault();
                if (!pending) return;
                setConfirming(true);
                try {
                  await pending.onConfirm();
                } finally {
                  setConfirming(false);
                  setDialogOpen(false);
                }
              }}
            >
              {confirming ? "Working…" : pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
