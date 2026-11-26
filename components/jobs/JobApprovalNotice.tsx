"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { allowedMoves, type JobMove, type MoveViewer } from "@/helpers/jobs/job-states";
import CloseJobDialog from "./CloseJobDialog";
import { useJobStateMove } from "./use-job-state-move";

export type JobApprovalNoticeStatus =
  | {
      kind: "pending";
      submittedAt: string;
      submitterName: string | null;
      editedAfterSubmission: boolean;
    }
  | { kind: "changes_requested"; note: string; at: string; byName: string | null };

/**
 * The Overview's approval notice (JL-REQ-020, JL-REQ-022). A pending job shows
 * who submitted it and when, "Edited after it was submitted" when it changed
 * since, and the moves the viewer may make: Approve and Request changes for
 * approvers, Withdraw for the submitter. A draft sent back shows the note.
 */
export default function JobApprovalNotice({
  job,
  status,
  viewer,
}: {
  job: { id: string; title: string };
  status: JobApprovalNoticeStatus;
  viewer: MoveViewer;
}) {
  const [requesting, setRequesting] = useState(false);
  const { apply, busy, dialog: upgradeDialog } = useJobStateMove(job.id);

  if (status.kind === "changes_requested") {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-lg border p-4">
        <p className="text-sm font-medium">
          Changes requested{status.byName ? ` by ${status.byName}` : ""} on {format(new Date(status.at), "PPP")}
        </p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{status.note}</p>
      </div>
    );
  }

  const moves = allowedMoves("pending_approval", viewer);
  const byKind = (kind: JobMove["kind"]) => moves.find((m) => m.kind === kind);
  const approve = byKind("approve");
  const requestChanges = byKind("request_changes");
  const withdraw = byKind("withdraw");

  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Waiting for approval</p>
        <p className="text-sm text-muted-foreground">
          Submitted{status.submitterName ? ` by ${status.submitterName}` : ""} on{" "}
          {format(new Date(status.submittedAt), "PPP")}.
          {status.editedAfterSubmission && <span className="font-medium text-foreground"> Edited after it was submitted.</span>}
        </p>
      </div>
      {moves.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {withdraw && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void apply(withdraw)}>
              {withdraw.label}
            </Button>
          )}
          {requestChanges && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setRequesting(true)}>
              {requestChanges.label}
            </Button>
          )}
          {approve && (
            <Button variant="brand" size="sm" disabled={busy} onClick={() => void apply(approve)}>
              {approve.label}
            </Button>
          )}
        </div>
      )}
      {requesting && requestChanges && (
        <CloseJobDialog
          open
          onOpenChange={setRequesting}
          kind="request_changes"
          jobTitle={job.title}
          onSubmit={(values) => apply(requestChanges, values)}
        />
      )}
      {upgradeDialog}
    </div>
  );
}
