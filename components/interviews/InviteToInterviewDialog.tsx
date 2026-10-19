"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inviteToInterviewAction } from "@/app/actions/interviews/invite-to-interview";
import { useEntitlementError } from "@/hooks/useEntitlementError";

/** SI-REQ-012; mirrors the invite helper's cap. */
export const MAX_INTERVIEW_INVITES = 50;

const applicants = (n: number) => `${n} applicant${n === 1 ? "" : "s"}`;

/**
 * Confirms "Invite to AI interview" for one or more applications of a job,
 * with the cost (SI-REQ-010/012, SIT-062/064). Lists anyone skipped and why;
 * the upgrade dialog opens when none could be paid for. While the job's
 * interview is off it explains that and links to the job's interview page,
 * so the invite buttons can show either way.
 */
export default function InviteToInterviewDialog({
  open,
  onOpenChange,
  jobPostId,
  applicationIds,
  nameOf = () => "Applicant",
  durationMinutes,
  enabled = true,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobPostId: string;
  applicationIds: string[];
  nameOf?: (applicationId: string) => string;
  durationMinutes: number;
  /** The job's AI interview is on. */
  enabled?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { handle: handleEntitlement, dialog: upgradeDialog } = useEntitlementError();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ invited: number; skipped: { id: string; message: string }[] } | null>(
    null,
  );
  const count = applicationIds.length;
  const tooMany = count > MAX_INTERVIEW_INVITES;

  useEffect(() => {
    if (open) setOutcome(null);
  }, [open]);

  async function invite() {
    setBusy(true);
    try {
      const result = await inviteToInterviewAction({ jobPostId, applicationIds });
      if (await handleEntitlement(result)) {
        onOpenChange(false);
        return;
      }
      if (!("ok" in result) || !result.ok) {
        toast.error(typeof result.error === "string" ? result.error : result.error.message);
        return;
      }
      if (result.invited > 0) {
        onDone?.();
        router.refresh();
      }
      if (result.skipped.length === 0) {
        toast.success(`Invited ${applicants(result.invited)}.`);
        onOpenChange(false);
        return;
      }
      setOutcome({ invited: result.invited, skipped: result.skipped });
    } catch {
      toast.error("Couldn't send the invites. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on the AI interview first</DialogTitle>
            <DialogDescription>
              This job&apos;s AI interview is off. Choose the competencies to assess and turn it on, then invite
              applicants.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button asChild variant="brand">
              <Link href={`/company/job-posts/${jobPostId}/interview`}>Set up the AI interview</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      {upgradeDialog}
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {count === 1 ? `Invite ${nameOf(applicationIds[0])} to the AI interview` : `Invite ${applicants(count)} to the AI interview`}
            </DialogTitle>
            <DialogDescription>
              Each invite holds {durationMinutes} interview minutes, up to {count * durationMinutes} interview minutes
              in total. Minutes are charged only when an interview is completed; the rest are released.
            </DialogDescription>
          </DialogHeader>

          {tooMany && <p className="text-sm text-destructive">Invite up to {MAX_INTERVIEW_INVITES} at a time.</p>}

          {outcome && (
            <div className="space-y-2 text-sm">
              <p>
                Invited {outcome.invited}. {outcome.skipped.length} weren&apos;t invited:
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
                {outcome.skipped.map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{nameOf(s.id)}</span>
                    <span className="text-muted-foreground">{s.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            {outcome ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="brand" disabled={busy || tooMany || count === 0} onClick={() => void invite()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send invites
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
