"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import CloseJobDialog from "./CloseJobDialog";
import { useJobStateMove } from "./use-job-state-move";

/**
 * The job's Overview notice once its hires reach its openings (JL-REQ-013, D5):
 * Mark as filled opens the fill dialog. Shown only to `jobs.publish` on an
 * open or paused job (the page decides); nothing changes until it's used.
 */
export default function FillJobNotice({
  job,
  hires,
  openInterviews = 0,
}: {
  job: { id: string; title: string; openings: number };
  hires: number;
  /** Open AI screening interviews, offered for cancelling (D9). */
  openInterviews?: number;
}) {
  const [open, setOpen] = useState(false);
  const { apply, busy, dialog: upgradeDialog } = useJobStateMove(job.id);

  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">
          You&apos;ve hired {hires} of {job.openings} for this job.
        </p>
        <p className="text-sm text-muted-foreground">
          Mark it as filled to stop taking applications. You can reopen it later.
        </p>
      </div>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>
        Mark as filled
      </Button>
      {open && (
        <CloseJobDialog
          open
          onOpenChange={setOpen}
          kind="fill"
          jobTitle={job.title}
          openInterviews={openInterviews}
          onSubmit={(values) => apply({ to: "filled", kind: "fill" }, values)}
        />
      )}
      {upgradeDialog}
    </div>
  );
}
