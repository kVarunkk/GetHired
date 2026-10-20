import type { PipelineStageKind } from "@/helpers/pipeline/status-map";
import { cn } from "@/utils/utils";

export type FunnelStripStage = {
  stageId: string;
  name: string;
  kind: PipelineStageKind;
  count: number;
  conversion?: number | null;
  medianDays?: number | null;
};

const percent = (n: number) => `${Math.round(n * 100)}%`;
const days = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)}d`;

/**
 * Stage counts in a row (PL-TASK-050): the job page's funnel, with conversion
 * from the previous step and the median days spent in each stage, or the
 * dashboard's totals.
 */
export default function FunnelStrip({
  stages,
  className,
}: {
  stages: FunnelStripStage[];
  className?: string;
}) {
  if (stages.length === 0) return null;

  return (
    <ol
      aria-label="Pipeline funnel"
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7", className)}
    >
      {stages.map((stage) => (
        <li key={stage.stageId} className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
          <span className="truncate text-xs text-muted-foreground">{stage.name}</span>
          <span className="text-xl font-semibold tracking-tight">{stage.count}</span>
          {(stage.conversion != null || stage.medianDays != null) && (
            <span className="text-xs text-muted-foreground">
              {[
                stage.conversion != null ? `${percent(stage.conversion)} reached` : null,
                stage.medianDays != null ? `${days(stage.medianDays)} median` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
