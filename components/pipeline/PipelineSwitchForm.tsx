"use client";

import { useEffect, useReducer, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { previewJobPipelineSwitchAction } from "@/app/actions/pipeline/preview-job-pipeline-switch";
import { setJobPipelineAction } from "@/app/actions/pipeline/set-job-pipeline";
import StickyActionBar from "@/components/StickyActionBar";
import NewPipelineDialog, { PIPELINE_LIMIT_REACHED, type NewPipelineSource } from "./NewPipelineDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { jobPipelinePath } from "@/helpers/jobs/paths";
import { pipelineEditorPath } from "@/helpers/pipeline/config";
import { CANDIDATE_STATUS_LABELS, pipelineReasonCopy } from "@/helpers/pipeline/copy";
import type { SwitchPreviewRow } from "@/helpers/pipeline/pipelines";
import {
  blockedReason,
  canSave,
  initialPipelineSwitch,
  pipelineSwitchReducer,
  type PipelineSwitchState,
} from "./pipeline-switch-machine";

export const NO_EMAIL_NOTE = "Candidates won't see a change and won't be emailed.";

type PipelineOption = { id: string; name: string };

/** The Select's sentinel for "New pipeline…" (Radix items can't have an empty value). */
export const NEW_PIPELINE_VALUE = "__new_pipeline__";

/** What "New pipeline…" needs; absent without settings.stages. */
export type NewPipelineOption = { sources: NewPipelineSource[]; atLimit: boolean; canUseAgent: boolean };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * JPT-036 (JP-REQ-006): moves a job and its candidates to another pipeline.
 * Pick the pipeline, check where each stage's candidates land (only stages
 * that show candidates the same status are offered), then save. The flow is
 * `pipeline-switch-machine.ts`; this does the loading and saving. With
 * `newPipeline` (settings.stages) the list ends with "New pipeline…", which
 * creates one (a copy of the job's pipeline by default) and comes back here
 * with it picked.
 */
export default function PipelineSwitchForm({
  jobPostId,
  current,
  pipelines,
  initialTargetId,
  newPipeline,
}: {
  jobPostId: string;
  current: PipelineOption;
  /** The company's other active pipelines. */
  pipelines: PipelineOption[];
  initialTargetId: string | null;
  newPipeline?: NewPipelineOption;
}) {
  const [state, dispatch] = useReducer(pipelineSwitchReducer, initialTargetId, initialPipelineSwitch);
  const { targetId, preview, phase } = state;
  const [creating, setCreating] = useState(false);
  // Bumped on each open, so the dialog starts empty every time.
  const [createKey, setCreateKey] = useState(0);

  function pick(value: string) {
    if (value === NEW_PIPELINE_VALUE) {
      setCreateKey((k) => k + 1);
      setCreating(true);
      return;
    }
    dispatch({ type: "pickTarget", targetId: value });
  }

  useEffect(() => {
    if (phase !== "loading" || !targetId) return;
    let cancelled = false;
    void previewJobPipelineSwitchAction({ jobPostId, pipelineId: targetId })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) dispatch({ type: "previewed", preview: result });
        else dispatch({ type: "previewFailed", targetId, error: result.error });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "previewFailed", targetId, error: "Couldn't load the pipeline." });
      });
    return () => {
      cancelled = true;
    };
  }, [jobPostId, targetId, phase]);

  async function save() {
    if (!canSave(state) || !targetId) return;
    dispatch({ type: "submit" });
    const succeeded = () => {
      dispatch({ type: "saved" });
      toast.success(`This job now uses ${preview?.to.name ?? "the new pipeline"}.`);
    };
    try {
      const result = await setJobPipelineAction({ jobPostId, pipelineId: targetId, mapping: state.mapping });
      if (result) {
        dispatch({ type: "failed", error: result.error });
        return;
      }
      succeeded();
    } catch (err) {
      // On success the action redirects to the Pipeline section. Next applies
      // the navigation and then rejects the action's promise with the redirect,
      // so that rejection means the switch worked.
      if (isRedirectError(err)) succeeded();
      else dispatch({ type: "failed", error: "Couldn't switch the job's pipeline." });
    }
  }

  const busy = phase === "saving" || phase === "saved";
  const inUse = preview?.rows.filter((row) => row.inUse) ?? [];
  const idle = preview?.rows.filter((row) => !row.inUse) ?? [];

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid max-w-sm gap-2">
        <Label htmlFor="switch-target">New pipeline</Label>
        <Select
          value={targetId ?? undefined}
          onValueChange={pick}
          disabled={busy || (pipelines.length === 0 && !newPipeline)}
        >
          <SelectTrigger id="switch-target" aria-label="New pipeline">
            <SelectValue placeholder="Pick a pipeline" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
            {newPipeline && (
              <>
                {pipelines.length > 0 && <SelectSeparator />}
                <SelectItem
                  value={NEW_PIPELINE_VALUE}
                  disabled={newPipeline.atLimit}
                  title={newPipeline.atLimit ? PIPELINE_LIMIT_REACHED : undefined}
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" aria-hidden />
                    New pipeline…
                  </span>
                </SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        {newPipeline && (
          <NewPipelineDialog
            key={createKey}
            open={creating}
            onOpenChange={setCreating}
            forJobId={jobPostId}
            initialSourceId={current.id}
            sources={newPipeline.sources}
            atLimit={newPipeline.atLimit}
            canUseAgent={newPipeline.canUseAgent}
          />
        )}
        <p className="text-sm text-muted-foreground">
          Now on {current.name}. {NO_EMAIL_NOTE}
        </p>
      </div>

      {phase === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the stages…
        </p>
      )}

      {preview && phase !== "loading" && (
        <>
          {preview.missing.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/50 p-4 text-sm">
              {preview.missing.map((m) => (
                <p key={m.stage.id} className="text-destructive">
                  {pipelineReasonCopy("missing_status", { stage: m.stage, status: m.status })}
                </p>
              ))}
              <Link
                href={pipelineEditorPath(preview.to.id)}
                className="font-medium underline-offset-4 hover:underline"
              >
                Edit {preview.to.name}
              </Link>
            </div>
          )}

          {inUse.length > 0 ? (
            <section aria-labelledby="switch-mapping" className="flex flex-col gap-2">
              <h3 id="switch-mapping" className="text-sm font-semibold">
                Where candidates go
              </h3>
              <ul aria-label="Stage mapping" className="divide-y rounded-lg border">
                {inUse.map((row) => (
                  <MappingRow key={row.stage.id} row={row} state={state} disabled={busy} dispatch={dispatch} />
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">No candidates or interview plan items to move.</p>
          )}

          {idle.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Empty stages with nothing to move: {idle.map((row) => row.stage.name).join(", ")}.
            </p>
          )}
        </>
      )}

      <StickyActionBar>
        <Button type="submit" variant="brand" disabled={!canSave(state)}>
          {phase === "saving" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Switch pipeline
        </Button>
        <Button asChild variant="outline">
          <Link href={jobPipelinePath(jobPostId)}>Cancel</Link>
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : (
          blockedReason(state) === "same" && (
            <p className="text-sm text-muted-foreground">This job already uses {preview?.to.name}.</p>
          )
        )}
      </StickyActionBar>
    </form>
  );
}

function MappingRow({
  row,
  state,
  disabled,
  dispatch,
}: {
  row: SwitchPreviewRow;
  state: PipelineSwitchState;
  disabled: boolean;
  dispatch: (event: { type: "mapStage"; stageId: string; targetStageId: string }) => void;
}) {
  const id = `map-${row.stage.id}`;
  const counts = [
    plural(row.applications, "candidate"),
    ...(row.planItems > 0 ? [plural(row.planItems, "interview plan item")] : []),
  ].join(" · ");
  return (
    <li className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{row.stage.name}</span>
          {row.stage.archived && <Badge variant="outline">Archived</Badge>}
        </span>
        <span className="text-xs text-muted-foreground">
          {counts} · shows “{CANDIDATE_STATUS_LABELS[row.status]}”
        </span>
      </div>
      <ArrowRight aria-hidden className="hidden h-4 w-4 text-muted-foreground sm:block" />
      {row.options.length > 0 ? (
        <Select
          value={state.mapping[row.stage.id] ?? undefined}
          onValueChange={(value) => dispatch({ type: "mapStage", stageId: row.stage.id, targetStageId: value })}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-label={`New stage for ${row.stage.name}`}>
            <SelectValue placeholder="Pick a stage" />
          </SelectTrigger>
          <SelectContent>
            {row.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-destructive">No stage shows “{CANDIDATE_STATUS_LABELS[row.status]}”</span>
      )}
    </li>
  );
}
