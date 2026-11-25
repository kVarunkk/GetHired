"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveApplicationNoteAction } from "@/app/actions/tracker/save-application-note";
import { TRACKER_LIMITS } from "@/helpers/tracker/schema";
import type { TrackerItem } from "@/helpers/tracker/types";
import { JOB_CLOSED_LABEL, LOCKED_TOOLTIP } from "./TrackerCard";

/** A GetHired application's page: the job and status read-only, and the applicant's private note (AT-REQ-023). */
export default function GetHiredDetail({ item }: { item: TrackerItem }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [followUp, setFollowUp] = useState(item.nextFollowUpAt ?? "");

  const save = () =>
    startSaving(async () => {
      const result = await saveApplicationNoteAction({ applicationId: item.id, notes: notes || null, nextFollowUpAt: followUp || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          {item.statusLabel}
        </Badge>
        {item.jobClosed && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {JOB_CLOSED_LABEL}
          </Badge>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {LOCKED_TOOLTIP}
        </span>
      </div>
      {item.jobClosed && (
        <p className="text-sm text-muted-foreground">
          The company has closed this posting, so it no longer takes new applications. Yours is still with them, and its status updates here.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {item.allJobsId && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/jobs/${item.allJobsId}`}>View job</Link>
          </Button>
        )}
        {item.screeningInterviewId && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/interview/screening/${item.screeningInterviewId}`}>Open AI interview</Link>
          </Button>
        )}
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-muted-foreground">Only you can see this note. The company never does.</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-followup">Follow up on</Label>
          <Input id="gh-followup" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="w-48" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-notes">Notes</Label>
          <Textarea id="gh-notes" rows={6} value={notes} maxLength={TRACKER_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <Button type="submit" variant="brand" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save note
          </Button>
        </div>
      </form>
    </div>
  );
}
