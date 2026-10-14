"use client";

import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { KEY_LABELS, type EntitlementKey, type EntitlementState } from "@/helpers/billing/keys";
import { fetcher } from "@/utils/utils";
import { cn } from "@/utils/utils";

export type UsageBannerData = {
  status: string;
  graceUntil: string | null;
  entitlements: Partial<Record<EntitlementKey, EntitlementState>>;
};

type Notice = { level: "warning" | "error"; text: string } | null;

/** What to show: grace first, then the fullest allowance at 100%, then at 80%. */
export function usageNotice(data: UsageBannerData): Notice {
  if (data.status === "past_due") {
    const until = data.graceUntil
      ? new Date(data.graceUntil).toLocaleDateString("en-US", { month: "long", day: "numeric" })
      : "soon";
    return {
      level: "error",
      text: `We couldn't take your last payment. Your plan keeps working until ${until}; update your payment method to keep it.`,
    };
  }

  let worst: { key: EntitlementKey; ratio: number } | null = null;
  for (const [key, e] of Object.entries(data.entitlements) as [EntitlementKey, EntitlementState][]) {
    if (!e || e.kind !== "allowance" || !e.amount) continue;
    const ratio = e.used / e.amount;
    if (!worst || ratio > worst.ratio) worst = { key, ratio };
  }
  if (!worst || worst.ratio < 0.8) return null;

  const label = KEY_LABELS[worst.key].many;
  return worst.ratio >= 1
    ? { level: "error", text: `You've used all your ${label} this month.` }
    : { level: "warning", text: `You've used ${Math.floor(worst.ratio * 100)}% of your ${label} this month.` };
}

/** §4.4: shown on company pages at 80% / 100% of an allowance and during grace. */
export default function UsageBanner({ data }: { data: UsageBannerData }) {
  const notice = usageNotice(data);
  if (!notice) return null;
  const Icon = notice.level === "error" ? AlertCircle : AlertTriangle;

  return (
    <div
      role={notice.level === "error" ? "alert" : "status"}
      className={cn(
        "mx-4 mt-4 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        notice.level === "error"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-warning/40 bg-warning/10",
      )}
    >
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        {notice.text}
      </span>
      <Link href="/company/billing" className="shrink-0 font-medium underline underline-offset-4">
        {data.status === "past_due" ? "Update payment" : "See plans"}
      </Link>
    </div>
  );
}

export const COMPANY_BILLING_KEY = "/api/company/billing";

/** Loads the banner's data without holding up the page. */
export function UsageBannerLoader() {
  const { data } = useSWR<UsageBannerData>(COMPANY_BILLING_KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
  });
  if (!data?.entitlements) return null;
  return <UsageBanner data={data} />;
}
