"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import toast from "react-hot-toast";
import { saveStagesAction } from "@/app/actions/pipeline/save-stages";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_KIND_LABELS, type PipelineStageKind } from "@/helpers/pipeline/status-map";
import { candidateStatusLabel, type StageOption } from "./StagePicker";

const MAX_STAGES = 12;
const PROTECTED = new Set<PipelineStageKind>(["applied", "hired", "rejected"]);
const KIND_LABELS = STAGE_KIND_LABELS;
const KINDS = Object.keys(KIND_LABELS) as PipelineStageKind[];

/**
 * Company settings: one pipeline's stages (PL-TASK-032, PL-REQ-001, JPT-033).
 * Rename, reorder with the arrow buttons (keyboard friendly), archive, and add
 * up to 12. Applied, Hired and Rejected can't be archived; a stage with
 * applications in it is refused inline. A pipeline more than one job uses
 * warns that changes apply to all of them (JP-REQ-008).
 */
export default function StageEditor({
  pipelineId,
  stages: initial,
  sharedByJobs = 0,
}: {
  pipelineId: string;
  stages: StageOption[];
  /** Jobs on this pipeline, open and closed. */
  sharedByJobs?: number;
}) {
  const [stages, setStages] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<PipelineStageKind>("screening");
  const [isAdding, setIsAdding] = useState(false);
  const [archiving, setArchiving] = useState<StageOption | null>(null);

  const setError = (id: string, error: string | null) =>
    setErrors((current) => {
      const next = { ...current };
      if (error) next[id] = error;
      else delete next[id];
      return next;
    });

  const rename = async (stage: StageOption, name: string) => {
    const trimmed = name.trim();
    if (trimmed === stage.name) return;
    const result = await saveStagesAction({ op: "rename", stageId: stage.id, name: trimmed, pipelineId });
    if (!result.ok) {
      setError(stage.id, result.error);
      return;
    }
    setError(stage.id, null);
    setStages((current) => current.map((s) => (s.id === stage.id ? { ...s, name: trimmed } : s)));
  };

  const move = async (index: number, by: -1 | 1) => {
    const previous = stages;
    const next = [...stages];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setStages(next);
    const result = await saveStagesAction({ op: "reorder", ids: next.map((s) => s.id), pipelineId });
    if (!result.ok) {
      setStages(previous);
      toast.error(result.error);
    }
  };

  const archive = async (stage: StageOption) => {
    const result = await saveStagesAction({ op: "archive", stageId: stage.id, pipelineId });
    if (!result.ok) {
      setError(stage.id, result.error);
      return;
    }
    setStages((current) => current.filter((s) => s.id !== stage.id));
  };

  const add = async () => {
    setIsAdding(true);
    try {
      const result = await saveStagesAction({ op: "create", name: newName.trim(), kind: newKind, pipelineId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.stage) {
        const { id, name, kind } = result.stage;
        setStages((current) => [...current, { id, name, kind }]);
      }
      setNewName("");
    } finally {
      setIsAdding(false);
    }
  };

  const full = stages.length >= MAX_STAGES;

  return (
    <div className="flex flex-col gap-4">
      {sharedByJobs > 1 && (
        <p role="status" className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Used by {sharedByJobs} jobs. Changes apply to all of them.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="flex flex-col gap-1 rounded-lg border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Name of ${stage.name}`}
                defaultValue={stage.name}
                maxLength={40}
                className="h-8 max-w-[220px]"
                onBlur={(e) => void rename(stage, e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                {KIND_LABELS[stage.kind]} · candidate sees{" "}
                <span className="capitalize">{candidateStatusLabel(stage.kind)}</span>
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Move ${stage.name} up`}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Move ${stage.name} down`}
                  disabled={index === stages.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {!PROTECTED.has(stage.kind) && (
                  <Button
                    size="sm"
                    variant="destructive-ghost"
                    aria-label={`Archive ${stage.name}`}
                    onClick={() => setArchiving(stage)}
                  >
                    Archive
                  </Button>
                )}
              </span>
            </div>
            {errors[stage.id] && (
              <p role="alert" className="text-xs text-destructive">
                {errors[stage.id]}
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New stage name"
          placeholder="New stage"
          value={newName}
          maxLength={40}
          className="h-8 max-w-[220px]"
          onChange={(e) => setNewName(e.target.value)}
        />
        <Select value={newKind} onValueChange={(v) => setNewKind(v as PipelineStageKind)}>
          <SelectTrigger className="h-8 w-[150px]" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={full || isAdding || !newName.trim()} onClick={() => void add()}>
          Add stage
        </Button>
      </div>
      {full && <p className="text-sm text-muted-foreground">A pipeline can have at most {MAX_STAGES} stages.</p>}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="It's removed from your pipeline and boards. Archived stages can't be restored here."
        confirmLabel="Archive"
        onConfirm={() => archiving && archive(archiving)}
      />
    </div>
  );
}
