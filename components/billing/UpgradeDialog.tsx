"use client";

import { useEffect } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { ArrowUpRight, Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EntitlementPayload } from "@/helpers/billing/errors";
import { KEY_LABELS } from "@/helpers/billing/keys";
import { PostHogEvent } from "@/utils/types";

type UpgradeDialogProps = {
  payload: EntitlementPayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Retry the action paying with credits. Without it, "Use credits" isn't offered. */
  onUseCredits?: () => void;
};

/** BL-REQ-020: the one dialog for every limit and allowance. */
export default function UpgradeDialog({
  payload,
  open,
  onOpenChange,
  onUseCredits,
}: UpgradeDialogProps) {
  useEffect(() => {
    if (!open || !payload) return;
    posthog.capture(PostHogEvent.BillingUpgradeDialogShown, {
      key: payload.key,
      kind: payload.kind,
      suggestedTier: payload.suggestedTier?.slug ?? null,
    });
  }, [open, payload]);

  if (!payload) return null;

  const label = KEY_LABELS[payload.key].many;
  const isLimit = payload.kind === "limit";
  const canOverage = !isLimit && payload.overageCredits !== null;
  const creditsNeeded =
    payload.creditsNeeded > 0
      ? payload.creditsNeeded
      : payload.qty * (payload.overageCredits ?? 0);
  const canUseCredits =
    canOverage && !!onUseCredits && creditsNeeded > 0 && payload.creditBalance >= creditsNeeded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-semibold tracking-tight">
            {isLimit ? "You've reached your plan's limit" : `You've run out of ${label}`}
          </DialogTitle>
          <DialogDescription className="text-[15px] leading-7">
            {isLimit
              ? `You're using ${payload.used} of ${payload.amount} ${label} on your plan.`
              : `You've used ${payload.used} of ${payload.amount} ${label} this month.`}{" "}
            {canOverage &&
              (canUseCredits
                ? `You can continue with ${creditsNeeded} credits (you have ${payload.creditBalance}).`
                : `Credits cover more (${payload.overageCredits} per unit); you have ${payload.creditBalance}.`)}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {payload.suggestedTier && (
            <Button asChild variant="brand" className="w-full">
              <Link href={`/company/billing?plan=${payload.suggestedTier.slug}`}>
                Upgrade to {payload.suggestedTier.name}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {canUseCredits && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onUseCredits?.();
              }}
            >
              <Coins className="h-4 w-4" />
              Use {creditsNeeded} credits
            </Button>
          )}
          {canOverage && (
            <Button asChild variant={payload.suggestedTier ? "ghost" : "outline"} className="w-full">
              <Link href="/company/billing#credits">Buy credits</Link>
            </Button>
          )}
          {!payload.suggestedTier && !canOverage && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/company/billing">See plans</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
