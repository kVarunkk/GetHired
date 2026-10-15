"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changesCandidateStatus,
  statusForKind,
  type PipelineStageKind,
} from "@/helpers/pipeline/status-map";
import { cn } from "@/utils/utils";

export type StageOption = { id: string; name: string; kind: PipelineStageKind };

/** The candidate-facing status, as the candidate's badge shows it. */
export const candidateStatusLabel = (kind: PipelineStageKind) =>
  statusForKind(kind).replace("_", " ");

/**
 * Moves one application between the company's active stages (PL-TASK-004),
 * replacing the old status select. A move the candidate will notice asks for
 * confirmation first; the rest move at once.
 */
export default function StagePicker({
  applicationId,
  stages,
  currentStageId,
}: {
  applicationId: string;
  /** Active stages, in position order. */
  stages: StageOption[];
  currentStageId: string | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(currentStageId ?? "");
  const [pending, setPending] = useState<StageOption | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const kindOf = (id: string) => stages.find((s) => s.id === id)?.kind ?? null;

  const move = async (target: StageOption) => {
    const previous = current;
    setPending(null);
    setCurrent(target.id);
    setIsMoving(true);
    try {
      const result = await moveApplicationsAction({
        applicationIds: [applicationId],
        stageId: target.id,
      });
      if (!result.ok) {
        setCurrent(previous);
        toast.error(result.error);
      } else if (result.moved === 0 && result.skipped.some((s) => s.reason === "not_found")) {
        setCurrent(previous);
        toast.error("Application not found.");
      } else {
        toast.success(`Moved to ${target.name}.`);
        router.refresh();
      }
    } catch {
      setCurrent(previous);
      toast.error("Couldn't move the application. Please try again.");
    } finally {
      setIsMoving(false);
    }
  };

  const choose = (id: string) => {
    const target = stages.find((s) => s.id === id);
    if (!target || id === current) return;
    if (changesCandidateStatus(kindOf(current), target.kind)) setPending(target);
    else void move(target);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative flex items-center gap-2">
        <span className="text-sm font-medium">Stage</span>
        <Select value={current} onValueChange={choose} disabled={isMoving || pending !== null}>
          <SelectTrigger className={cn("w-[180px]", isMoving && "opacity-50")} aria-label="Stage">
            <SelectValue placeholder="Choose a stage" />
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isMoving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Moving" />
        )}
      </div>

      {pending && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <p>
            Move to <span className="font-medium">{pending.name}</span>? The candidate will see:{" "}
            <span className="font-medium capitalize">{candidateStatusLabel(pending.kind)}</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="brand" onClick={() => void move(pending)}>
              Move
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
