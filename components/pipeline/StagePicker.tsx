"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import RoleLocked from "@/components/team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import {
  changesCandidateStatus,
  statusForKind,
  type PipelineStageKind,
} from "@/helpers/pipeline/status-map";
import type { MoveEmail } from "@/helpers/pipeline/move";
import { cn } from "@/utils/utils";
import MoveDialog, { type TemplateOption } from "./MoveDialog";

export type StageOption = { id: string; name: string; kind: PipelineStageKind };

/** The candidate-facing status, as the candidate's badge shows it. */
export const candidateStatusLabel = (kind: PipelineStageKind) =>
  statusForKind(kind).replace("_", " ");

/**
 * Moves one application between the company's active stages (PL-TASK-004),
 * replacing the old status select. A move the candidate will notice opens
 * `MoveDialog` first, which can email them; the rest move at once.
 */
export default function StagePicker({
  applicationId,
  stages,
  currentStageId,
  templates = [],
  hasOpenInterview = false,
  canMove = true,
}: {
  applicationId: string;
  /** Active stages, in position order. */
  stages: StageOption[];
  currentStageId: string | null;
  /** The company's email templates, for the move dialog. */
  templates?: TemplateOption[];
  /** An open AI interview invite, which a move to Rejected or Hired cancels. */
  hasOpenInterview?: boolean;
  /** Without pipeline.move on the job the stage shows, locked. */
  canMove?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(currentStageId ?? "");
  const [pending, setPending] = useState<StageOption | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const kindOf = (id: string) => stages.find((s) => s.id === id)?.kind ?? null;

  const move = async (target: StageOption, email?: MoveEmail) => {
    const previous = current;
    setPending(null);
    setCurrent(target.id);
    setIsMoving(true);
    try {
      const result = await moveApplicationsAction({
        applicationIds: [applicationId],
        stageId: target.id,
        ...(email ? { email } : {}),
      });
      if (!result.ok) {
        setCurrent(previous);
        toast.error(result.error);
      } else if (result.moved === 0 && result.skipped.some((s) => s.reason === "not_found")) {
        setCurrent(previous);
        toast.error("Application not found.");
      } else if (result.skipped.some((s) => s.reason === "email_failed")) {
        toast.error(`Moved to ${target.name}, but the email couldn't be sent.`);
        router.refresh();
      } else {
        toast.success(
          result.emailed > 0
            ? `Moved to ${target.name}. The email is on its way.`
            : `Moved to ${target.name}.`,
        );
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

  const select = (
    <Select value={current} onValueChange={choose} disabled={!canMove || isMoving || pending !== null}>
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
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Stage</span>
      {canMove ? select : <RoleLocked reason={forbiddenMessage("pipeline.move")}>{select}</RoleLocked>}
      {isMoving && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Moving" />
      )}

      <MoveDialog
        open={pending !== null}
        count={1}
        stage={pending}
        changesStatus
        templates={templates}
        previewApplicationId={applicationId}
        fromKinds={[kindOf(current)]}
        openInterviews={hasOpenInterview ? 1 : 0}
        onConfirm={(email) => pending && void move(pending, email)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
