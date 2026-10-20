"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { KEY_LABELS, type AllowanceKey, type EntitlementState } from "@/helpers/billing/keys";

export type CostBreakdown = {
  /** Units that come out of the allowance. */
  fromAllowance: number;
  /** Credits for the units beyond it. */
  credits: number;
  canProceed: boolean;
};

/** What `qty` units would cost, from the company's current state. */
export function costOf(
  state: Pick<EntitlementState, "amount" | "remaining" | "overageCredits">,
  qty: number,
  creditBalance: number,
): CostBreakdown {
  if (state.amount === null || state.remaining === null) {
    return { fromAllowance: qty, credits: 0, canProceed: true };
  }
  const fromAllowance = Math.min(qty, state.remaining);
  const over = qty - fromAllowance;
  if (over === 0) return { fromAllowance, credits: 0, canProceed: true };
  if (state.overageCredits === null) return { fromAllowance, credits: 0, canProceed: false };
  const credits = over * state.overageCredits;
  return { fromAllowance, credits, canProceed: credits <= creditBalance };
}

type CostPreviewProps = {
  entitlementKey: AllowanceKey;
  qty: number;
  state: EntitlementState;
  creditBalance: number;
  /** Renders the confirm button, disabled when the action can't go ahead. */
  children?: (cost: CostBreakdown) => ReactNode;
};

/** BL-REQ-021: shown before any action that spends more than one unit. */
export default function CostPreview({ entitlementKey, qty, state, creditBalance, children }: CostPreviewProps) {
  const cost = costOf(state, qty, creditBalance);
  const label = KEY_LABELS[entitlementKey].many;
  const unlimited = state.amount === null;

  let line: string | null = null;
  if (!unlimited) {
    if (cost.credits === 0 && cost.fromAllowance === qty) {
      line = `This uses ${qty} of your ${state.remaining} remaining ${label}.`;
    } else if (cost.canProceed) {
      line =
        cost.fromAllowance > 0
          ? `This uses your ${cost.fromAllowance} remaining ${label} and ${cost.credits} credits.`
          : `This uses ${cost.credits} credits (no ${label} left this month).`;
    }
  }

  let warning: string | null = null;
  if (!cost.canProceed) {
    warning =
      state.overageCredits === null
        ? `This needs ${qty} ${label}, and you have ${state.remaining} left this month. Upgrade to do more.`
        : `This needs ${cost.credits} credits beyond your remaining ${label}, and you have ${creditBalance}.`;
  }

  return (
    <div className="flex flex-col gap-3">
      {line && <p className="text-sm text-muted-foreground">{line}</p>}
      {warning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
      {children?.(cost)}
    </div>
  );
}
