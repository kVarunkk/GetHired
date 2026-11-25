"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CLOSE_REASONS,
  CLOSE_REASON_LABEL,
  STATE_NOTE_MAX,
  type ManualCloseReason,
} from "@/helpers/jobs/job-states";

/** What the dialog asks for: closing, filling, or sending a pending job back. */
export type JobStateDialogKind = "close" | "fill" | "request_changes";

export type JobStateDialogValues = {
  reason: ManualCloseReason | null;
  note: string | null;
  cancelOpenInterviews: boolean;
};

const COPY: Record<JobStateDialogKind, { title: string; description: string; submit: string }> = {
  close: {
    title: "Close this job",
    description: "It stops taking applications and leaves the job board, your careers page and job sites. You can reopen it later.",
    submit: "Close job",
  },
  fill: {
    title: "Mark this job as filled",
    description: "It stops taking applications and leaves the job board, your careers page and job sites. Applicants only see that it's no longer accepting applications.",
    submit: "Mark as filled",
  },
  request_changes: {
    title: "Request changes",
    description: "The job goes back to a draft, and the person who submitted it sees your note.",
    submit: "Send back",
  },
};

/**
 * The small dialog for a close, a fill or a request for changes (JL-REQ-030,
 * D9): a reason (close only), a note (required to request changes), and,
 * when the job has open AI interviews, whether to cancel them (unchecked).
 */
export default function CloseJobDialog({
  open,
  onOpenChange,
  kind,
  jobTitle,
  openInterviews = 0,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: JobStateDialogKind;
  jobTitle: string;
  /** Open AI screening interviews on the job; the checkbox shows only above 0. */
  openInterviews?: number;
  /** Resolves true when the move applied, which closes the dialog. */
  onSubmit: (values: JobStateDialogValues) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<ManualCloseReason | null>(null);
  const [note, setNote] = useState("");
  const [cancelInterviews, setCancelInterviews] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    setCancelInterviews(false);
  }, [open, kind]);

  const copy = COPY[kind];
  const trimmed = note.trim();
  const canSubmit =
    !busy &&
    trimmed.length <= STATE_NOTE_MAX &&
    (kind !== "close" || reason !== null) &&
    (kind !== "request_changes" || trimmed.length > 0);
  const showInterviews = kind !== "request_changes" && openInterviews > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const applied = await onSubmit({
        reason: kind === "close" ? reason : null,
        note: trimmed || null,
        cancelOpenInterviews: showInterviews && cancelInterviews,
      });
      if (applied) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">{jobTitle}</span>. {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {kind === "close" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="close-reason">Reason</Label>
              <Select value={reason ?? undefined} onValueChange={(v) => setReason(v as ManualCloseReason)}>
                <SelectTrigger id="close-reason" aria-label="Reason">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CLOSE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {CLOSE_REASON_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="state-note">
              {kind === "request_changes" ? "What should change" : "Note (optional)"}
            </Label>
            <Textarea
              id="state-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={STATE_NOTE_MAX}
              rows={3}
              placeholder={kind === "request_changes" ? "The salary range is missing." : "Only your team sees this."}
            />
            <p className="text-xs text-muted-foreground">
              Only your team sees notes. {trimmed.length}/{STATE_NOTE_MAX}
            </p>
          </div>

          {showInterviews && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="cancel-interviews"
                checked={cancelInterviews}
                onCheckedChange={(v) => setCancelInterviews(v === true)}
              />
              <Label htmlFor="cancel-interviews" className="font-normal leading-snug">
                Cancel {openInterviews} open AI {openInterviews === 1 ? "interview" : "interviews"}
                <span className="block text-xs text-muted-foreground">
                  Their minutes are released. Scheduled interviews with your team aren&apos;t affected.
                </span>
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!canSubmit} onClick={() => void submit()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
