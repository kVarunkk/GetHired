import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CompanyFunnel } from "@/helpers/pipeline/funnel";
import { STAGE_KIND_LABELS, type PipelineStageKind } from "@/helpers/pipeline/status-map";

const STEPS: PipelineStageKind[] = ["applied", "screening", "interview", "offer", "hired"];
const ASIDE: PipelineStageKind[] = ["on_hold", "rejected"];

/**
 * CD-REQ-025: where applications on the open jobs stand now, one bar per
 * funnel step with its count beside it, and On hold and Rejected below.
 */
export default function CompanyPipelineCard({
  stages,
  newThisWeek,
}: {
  stages: CompanyFunnel["stages"];
  /** Applications in the last 7 days. */
  newThisWeek: number;
}) {
  const count = (kind: PipelineStageKind) => stages.find((s) => s.kind === kind)?.count ?? 0;
  const max = Math.max(1, ...STEPS.map(count));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Pipeline</h2>
            <p className="text-sm text-muted-foreground">
              {newThisWeek === 0
                ? "No new applications in the last 7 days"
                : `${newThisWeek} new ${newThisWeek === 1 ? "application" : "applications"} in the last 7 days`}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/company/applications">Applications</Link>
          </Button>
        </div>

        <dl className="flex flex-col gap-2">
          {STEPS.map((kind) => (
            <div key={kind} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm">
              <dt className="text-muted-foreground">{STAGE_KIND_LABELS[kind]}</dt>
              <div className="h-2 rounded-full bg-muted" aria-hidden>
                {count(kind) > 0 && (
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(count(kind) / max) * 100}%` }} />
                )}
              </div>
              <dd className="text-right font-medium tabular-nums">{count(kind)}</dd>
            </div>
          ))}
        </dl>

        <dl className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
          {ASIDE.map((kind) => (
            <div key={kind} className="flex gap-1.5">
              <dt>{STAGE_KIND_LABELS[kind]}</dt>
              <dd className="tabular-nums">{count(kind)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
