import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { KEY_LABELS } from "@/helpers/billing/keys";
import type { Usage } from "@/helpers/company-dashboard/load";
import { cn } from "@/utils/utils";

const BILLING = "/company/billing";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** CD-REQ-031: the plan and what's left of each allowance this period. */
export default function UsageCard({ usage }: { usage: Usage }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Plan and usage</h2>
            <p className="text-sm text-muted-foreground">{usage.planName} plan</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={BILLING}>Billing</Link>
          </Button>
        </div>
        <ul className="flex flex-col gap-3">
          {usage.meters.map((meter) => {
            const label = capitalise(KEY_LABELS[meter.key].many);
            const left =
              meter.amount === null || meter.remaining === null
                ? "Unlimited"
                : `${meter.remaining.toLocaleString("en-US")} of ${meter.amount.toLocaleString("en-US")} left`;
            return (
              <li key={meter.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{label}</span>
                  {meter.low ? (
                    <Link href={BILLING} className="font-medium text-destructive tabular-nums hover:underline">
                      {left}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground tabular-nums">{left}</span>
                  )}
                </div>
                {meter.amount !== null && meter.remaining !== null && (
                  <Progress
                    value={Math.min(100, (meter.remaining / meter.amount) * 100)}
                    aria-label={`${label}: ${left}`}
                    className={cn("h-1.5", meter.low && "ring-1 ring-destructive/40")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
