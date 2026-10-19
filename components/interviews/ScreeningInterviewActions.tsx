"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  manageScreeningInterviewAction,
  type ManageScreeningAction,
} from "@/app/actions/interviews/manage-screening-interview";
import InviteToInterviewDialog from "./InviteToInterviewDialog";

/** SI-REQ-015: two extensions of 1–14 days each. */
const MAX_EXTENSIONS = 2;
const EXTEND_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 1);

export type InterviewActionState = {
  id: string;
  status: string;
  attemptsUsed: number;
  maxAttempts: number;
  attemptGranted: boolean;
  deadlineExtensions: number;
  /** A company report exists (scored or being scored). */
  hasReport: boolean;
};

const CONFIRMS: Record<Exclude<ManageScreeningAction, "extend">, { title: string; description: string; label: string }> = {
  reopen: {
    title: "Reopen the interview?",
    description:
      "The applicant is emailed the invite again, with a fresh deadline and the attempts they have left. The interview's minutes are held again.",
    label: "Reopen the interview",
  },
  cancel: {
    title: "Cancel the interview?",
    description: "The applicant can't take it any more. Held interview minutes are released.",
    label: "Cancel the interview",
  },
  waive: {
    title: "Waive the interview?",
    description: "The applicant moves on without an AI interview. Their application stays where it is.",
    label: "Waive the interview",
  },
  grant_attempt: {
    title: "Grant another attempt?",
    description: "The applicant can take the interview once more. This can be done once per interview.",
    label: "Grant another attempt",
  },
};

/**
 * The applicant page's interview actions (SI-REQ-015/026, SIT-064): Invite,
 * Extend, Grant attempt, Cancel, and Extend / Waive / Cancel for an
 * accommodation request. Rendered only with interviews.manage on the job;
 * the server checks again.
 */
export default function ScreeningInterviewActions({
  applicationId,
  jobPostId,
  candidateName,
  interview,
  invite,
  stageClosed = false,
}: {
  applicationId: string;
  jobPostId: string;
  candidateName: string;
  interview: InterviewActionState | null;
  /**
   * The job's interview length and whether it's on. Invite shows while it's
   * off too, and then points to the job's interview page.
   */
  invite: { durationMinutes: number; enabled: boolean };
  /** In a Rejected or Hired stage: no invite, extension, attempt or reopen. */
  stageClosed?: boolean;
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [extending, setExtending] = useState(false);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Exclude<ManageScreeningAction, "extend"> | null>(null);

  async function run(action: ManageScreeningAction, extra: { days?: number } = {}) {
    if (!interview) return false;
    const result = await manageScreeningInterviewAction({ id: interview.id, action, ...extra });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Interview updated.");
    router.refresh();
    return true;
  }

  if (!interview) {
    if (stageClosed) return null;
    return (
      <>
        <Button variant="outline" onClick={() => setInviting(true)}>
          <Mic className="mr-2 h-4 w-4" />
          Invite to AI interview
        </Button>
        <InviteToInterviewDialog
          open={inviting}
          onOpenChange={setInviting}
          jobPostId={jobPostId}
          applicationIds={[applicationId]}
          nameOf={() => candidateName}
          durationMinutes={invite.durationMinutes}
          enabled={invite.enabled}
        />
      </>
    );
  }

  const open = interview.status === "invited" || interview.status === "paused";
  const canExtend = !stageClosed && open && interview.deadlineExtensions < MAX_EXTENSIONS;
  const canGrant =
    !stageClosed &&
    !interview.attemptGranted &&
    ((interview.status === "invited" && interview.attemptsUsed > 0) ||
      (interview.status === "completed" && !interview.hasReport));
  const canWaive = interview.status === "paused";
  const canReopen =
    !stageClosed &&
    (interview.status === "cancelled" || interview.status === "expired") &&
    interview.attemptsUsed < interview.maxAttempts;

  return (
    <>
      {canReopen && (
        <Button variant="outline" onClick={() => setConfirm("reopen")}>
          <Mic className="mr-2 h-4 w-4" />
          Reopen interview
        </Button>
      )}
      {canExtend && (
        <Button variant="outline" onClick={() => setExtending(true)}>
          Extend deadline
        </Button>
      )}
      {canGrant && (
        <Button variant="outline" onClick={() => setConfirm("grant_attempt")}>
          Grant attempt
        </Button>
      )}
      {canWaive && (
        <Button variant="outline" onClick={() => setConfirm("waive")}>
          Waive interview
        </Button>
      )}
      {open && (
        <Button variant="destructive-outline" onClick={() => setConfirm("cancel")}>
          Cancel interview
        </Button>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={confirm ? CONFIRMS[confirm].title : ""}
        description={confirm ? CONFIRMS[confirm].description : ""}
        confirmLabel={confirm ? CONFIRMS[confirm].label : ""}
        confirmVariant={confirm === "grant_attempt" || confirm === "reopen" ? "brand" : "destructive"}
        onConfirm={() => (confirm ? run(confirm) : false)}
      />

      <Dialog open={extending} onOpenChange={(next) => !busy && setExtending(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend the deadline</DialogTitle>
            <DialogDescription>
              {interview.status === "paused"
                ? "Resumes the interview and adds the paused time back. "
                : ""}
              The applicant can be given {MAX_EXTENSIONS - interview.deadlineExtensions} more extension
              {MAX_EXTENSIONS - interview.deadlineExtensions === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="extend-days">Extend by</Label>
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value))} disabled={busy}>
              <SelectTrigger id="extend-days" aria-label="Extend by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXTEND_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} day{n === 1 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setExtending(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run("extend", { days });
                setBusy(false);
                if (ok) setExtending(false);
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
