"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import type { MoveEmail } from "@/helpers/pipeline/move";
import { changesCandidateStatus } from "@/helpers/pipeline/status-map";
import MoveDialog, { type TemplateOption } from "./MoveDialog";
import type { StageOption } from "./StagePicker";

/** PL-REQ-004 / PL-SEC-005; mirrors MAX_MOVE_APPLICATIONS on the server. */
const MAX_SELECTED = 50;

const plural = (n: number) => `${n} application${n === 1 ? "" : "s"}`;

/**
 * The pipeline list's bulk actions (PL-TASK-004): "Move to…" any active stage
 * and "Reject…" (the company's Rejected stage), both confirmed in
 * `MoveDialog`, which can email the candidates. Hidden with nothing selected.
 */
export default function BulkActionBar({
  selectedIds,
  stages,
  templates = [],
  stageIdOf = () => null,
  onDone,
}: {
  selectedIds: string[];
  /** Active stages, in position order. */
  stages: StageOption[];
  /** The company's email templates, for MoveDialog. */
  templates?: TemplateOption[];
  /** Each selected application's current stage, to tell whether a move changes its status. */
  stageIdOf?: (applicationId: string) => string | null;
  /** Called after a successful move, to clear the selection. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<StageOption | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  if (selectedIds.length === 0) return null;

  const tooMany = selectedIds.length > MAX_SELECTED;
  const disabled = tooMany || isMoving;
  const rejected = stages.find((s) => s.kind === "rejected");

  const kindOf = (stageId: string | null) => stages.find((s) => s.id === stageId)?.kind ?? null;
  const changesStatus = (stage: StageOption) =>
    selectedIds.some((id) => changesCandidateStatus(kindOf(stageIdOf(id)), stage.kind));

  const move = async (stage: StageOption, email?: MoveEmail) => {
    setIsMoving(true);
    try {
      const result = await moveApplicationsAction({
        applicationIds: selectedIds,
        stageId: stage.id,
        ...(email ? { email } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTarget(null);
      const skipped = result.skipped.filter((s) => s.reason === "not_found").length;
      const failed = result.skipped.filter((s) => s.reason === "email_failed").length;
      toast.success(
        `Moved ${plural(result.moved)} to ${stage.name}.` +
          (result.emailed > 0 ? ` Emailed ${result.emailed}.` : "") +
          (failed > 0 ? ` ${failed} email${failed === 1 ? "" : "s"} couldn't be sent.` : "") +
          (skipped > 0 ? ` ${plural(skipped)} couldn't be found.` : ""),
      );
      onDone();
      router.refresh();
    } catch {
      toast.error("Couldn't move the applications. Please try again.");
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{selectedIds.length} selected</span>
        {tooMany && (
          <span className="text-destructive">Select up to {MAX_SELECTED} to move them together.</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value=""
            onValueChange={(id) => setTarget(stages.find((s) => s.id === id) ?? null)}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[150px]" aria-label="Move to…">
              <SelectValue placeholder="Move to…" />
            </SelectTrigger>
            <SelectContent>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rejected && (
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => setTarget(rejected)}>
              Reject…
            </Button>
          )}
        </div>
      </div>

      <MoveDialog
        open={target !== null}
        count={selectedIds.length}
        stage={target}
        changesStatus={target ? changesStatus(target) : false}
        templates={templates}
        previewApplicationId={selectedIds[0] ?? null}
        isMoving={isMoving}
        onConfirm={(email) => target && void move(target, email)}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
