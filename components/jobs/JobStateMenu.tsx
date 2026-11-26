"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import RoleLocked from "@/components/team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import {
  JOB_STATE_LABEL,
  allowedMoves,
  type JobMove,
  type JobPostState,
  type MoveViewer,
} from "@/helpers/jobs/job-states";
import CloseJobDialog, { type JobStateDialogKind } from "./CloseJobDialog";
import JobStateBadge from "./JobStateBadge";
import { useJobStateMove } from "./use-job-state-move";

/** Moves that ask for a reason or a note first. */
const DIALOG_KINDS = new Set<JobMove["kind"]>(["close", "fill", "request_changes"]);

/**
 * The job's state and the moves the viewer may make from it (JL-REQ-029,
 * replacing the old on/off switch). Only allowed moves are listed; the server
 * checks them all again. Close, fill and request changes open a dialog.
 */
export default function JobStateMenu({
  job,
  viewer,
  openInterviews = 0,
  onMoved,
}: {
  job: { id: string; title: string; state: JobPostState };
  viewer: MoveViewer;
  /** Open AI screening interviews, offered for cancelling on a close (D9). */
  openInterviews?: number;
  /** After a move applied, e.g. to update a list in place. */
  onMoved?: (state: JobPostState) => void;
}) {
  const [state, setState] = useState(job.state);
  const [dialog, setDialog] = useState<{ kind: JobStateDialogKind; move: JobMove } | null>(null);
  const { apply, busy, dialog: upgradeDialog } = useJobStateMove(job.id, (next) => {
    setState(next);
    onMoved?.(next);
  });

  const moves = allowedMoves(state, viewer);

  const choose = (move: JobMove) => {
    if (DIALOG_KINDS.has(move.kind)) {
      setDialog({ kind: move.kind as JobStateDialogKind, move });
      return;
    }
    void apply(move);
  };

  if (moves.length === 0) {
    const badge = <JobStateBadge state={state} />;
    return viewer.canPublish ? badge : <RoleLocked reason={forbiddenMessage("jobs.publish")}>{badge}</RoleLocked>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Job state: ${JOB_STATE_LABEL[state]}. Change it`}
            className="gap-2"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <JobStateBadge state={state} />
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {JOB_STATE_LABEL[state]}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {moves.map((move) => (
            <DropdownMenuItem key={move.kind} onSelect={() => choose(move)}>
              {move.label}
              {DIALOG_KINDS.has(move.kind) ? "…" : ""}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog && (
        <CloseJobDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          kind={dialog.kind}
          jobTitle={job.title}
          openInterviews={openInterviews}
          onSubmit={(values) => apply(dialog.move, values)}
        />
      )}
      {upgradeDialog}
    </>
  );
}
