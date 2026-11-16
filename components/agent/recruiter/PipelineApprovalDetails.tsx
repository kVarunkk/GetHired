"use client";

import { useEffect, useState } from "react";
import { previewAgentCustomizeJobPipelineAction } from "@/app/actions/pipeline/preview-agent-customize-job-pipeline";
import { previewAgentJobPipelineSwitchAction } from "@/app/actions/pipeline/preview-agent-job-pipeline-switch";
import type {
  AgentCustomizePipelinePreview,
  AgentPipelineSwitchPreview,
} from "@/helpers/pipeline/preview-agent-pipeline";

export type PipelineApprovalTool = "setJobPipeline" | "customizeJobPipeline";

export const isPipelineApprovalTool = (name: string): name is PipelineApprovalTool =>
  name === "setJobPipeline" || name === "customizeJobPipeline";

type Preview = AgentPipelineSwitchPreview | AgentCustomizePipelinePreview;

const NO_CHANGE_NOTE = "Candidates won't see a change and won't be emailed.";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The approval card's details for the agent's `setJobPipeline` and
 * `customizeJobPipeline` (JPT-041): the job, the pipelines by name and where
 * each stage's applications land, from a server preview, so the user
 * approves names rather than ids.
 */
export function PipelineApprovalDetails({ tool, input }: { tool: PipelineApprovalTool; input: unknown }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    const load =
      tool === "setJobPipeline" ? previewAgentJobPipelineSwitchAction : previewAgentCustomizeJobPipelineAction;
    load(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [tool, key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;

  if ("moves" in preview) {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <p>
          <span className="font-medium">{preview.jobTitle}</span> moves from {preview.from} to{" "}
          <span className="font-medium">{preview.to}</span>.
        </p>
        {preview.moves.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {preview.moves.map((move) => (
              <li key={move.stage}>
                {move.stage} → {move.to}
                <span className="text-muted-foreground">
                  {" "}
                  ({count(move.applications, "application", "applications")}
                  {move.planItems > 0 ? `, ${count(move.planItems, "planned interview", "planned interviews")}` : ""})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No applications to move.</p>
        )}
        <p className="text-muted-foreground">{NO_CHANGE_NOTE}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <p>
        Copies {preview.from} ({count(preview.stages, "stage", "stages")}) as{" "}
        <span className="font-medium">{preview.name}</span> and moves{" "}
        <span className="font-medium">{preview.jobTitle}</span> onto it.
      </p>
      <p className="text-muted-foreground">
        {preview.otherJobs > 0
          ? `${count(preview.otherJobs, "other job keeps", "other jobs keep")} ${preview.from}.`
          : `No other job uses ${preview.from}.`}{" "}
        {NO_CHANGE_NOTE}
      </p>
    </div>
  );
}
