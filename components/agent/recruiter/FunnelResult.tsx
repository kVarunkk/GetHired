import Link from "next/link";
import FunnelStrip from "@/components/pipeline/FunnelStrip";
import type { PipelineStageKind } from "@/helpers/pipeline/status-map";
import { isInAppHref, NEW_TAB } from "../links";

export type FunnelResultData = {
  total?: number;
  stages: {
    name: string;
    kind: PipelineStageKind;
    count: number;
    conversion?: number | null;
    medianDays?: number | null;
  }[];
  timeToHireDays?: number | null;
  url?: string;
  needsAttention?: { applicationId: string; name: string; jobTitle: string; daysInApplied: number; url: string }[];
};

/** Rows of "needs attention" shown before the rest are left to the reply. */
const ATTENTION_SHOWN = 5;

/**
 * `getHiringFunnel`'s result (RA spec §4.7): the stage strip, and for the
 * company view the applications waiting too long in Applied.
 */
export function FunnelResult({ funnel }: { funnel: FunnelResultData }) {
  const stages = funnel.stages.map((s) => ({ ...s, stageId: `${s.kind}:${s.name}` }));
  const waiting = funnel.needsAttention ?? [];
  const facts = [
    typeof funnel.total === "number" && `${funnel.total} ${funnel.total === 1 ? "application" : "applications"}`,
    typeof funnel.timeToHireDays === "number" && `${funnel.timeToHireDays}d median time to hire`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <FunnelStrip stages={stages} className="lg:grid-cols-4" />
      {(facts.length > 0 || funnel.url) && (
        <p className="text-xs text-muted-foreground">
          {facts.join(" · ")}
          {funnel.url && isInAppHref(funnel.url) && (
            <>
              {facts.length > 0 && " · "}
              <Link {...NEW_TAB} href={funnel.url} className="underline underline-offset-4 hover:text-foreground">
                Open the job post
              </Link>
            </>
          )}
        </p>
      )}
      {waiting.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-foreground">Waiting in Applied</p>
          <ul className="divide-y rounded-lg border text-xs">
            {waiting.slice(0, ATTENTION_SHOWN).map((item) => (
              <li key={item.applicationId} className="flex items-center justify-between gap-3 px-3 py-2">
                {isInAppHref(item.url) ? (
                  <Link {...NEW_TAB} href={item.url} className="truncate font-medium text-foreground hover:underline">
                    {item.name}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-foreground">{item.name}</span>
                )}
                <span className="shrink-0 text-muted-foreground">
                  {item.jobTitle} · {item.daysInApplied}d
                </span>
              </li>
            ))}
          </ul>
          {waiting.length > ATTENTION_SHOWN && (
            <p className="text-xs text-muted-foreground">and {waiting.length - ATTENTION_SHOWN} more</p>
          )}
        </div>
      )}
    </div>
  );
}
