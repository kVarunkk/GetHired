import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SuggestedTier } from "@/helpers/billing/errors";

/** BL-REQ-023: the end of a capped talent search list. */
export default function HiddenCandidatesNotice({
  hiddenCount,
  upgradePlan,
}: {
  hiddenCount: number;
  upgradePlan: SuggestedTier | null;
}) {
  if (hiddenCount <= 0) return null;
  const candidates = hiddenCount === 1 ? "candidate" : "candidates";

  return (
    <div className="mt-4 flex flex-col items-start gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm">
          <span className="font-medium">
            {hiddenCount} more matching {candidates}
            {upgradePlan ? ` on ${upgradePlan.name}` : ""}
          </span>
          <span className="text-muted-foreground">
            {" "}
            Your plan shows the top results for each search.
          </span>
        </p>
      </div>
      <Button asChild variant="brand" size="sm">
        <Link href={upgradePlan ? `/company/billing?plan=${upgradePlan.slug}` : "/company/billing"}>
          {upgradePlan ? `Upgrade to ${upgradePlan.name}` : "See plans"}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
