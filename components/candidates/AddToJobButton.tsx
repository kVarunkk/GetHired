"use client";

import { useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import AddCandidatesToJobDialog from "@/components/candidates/AddCandidatesToJobDialog";
import { Button } from "@/components/ui/button";

/**
 * "Add to a job" for one company candidate (BI-REQ-005): opens
 * `AddCandidatesToJobDialog`. Render it only for members with
 * `applicants.import`. Disabled, with the reason on hover, when there's no
 * job left to add them to or they have no email.
 */
export default function AddToJobButton({
  candidate,
  jobs,
  importJobCount,
  size,
}: {
  candidate: { id: string; email: string | null };
  /** Jobs they can still be added to. */
  jobs: { id: string; title: string }[];
  /** Active jobs the member can import into, counting ones they're already in. */
  importJobCount: number;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const reason =
    importJobCount === 0
      ? "No active jobs to add them to"
      : jobs.length === 0
        ? "Already in all your active jobs"
        : !candidate.email
          ? "Add an email first"
          : undefined;

  return (
    <>
      {/* A disabled button gets no hover, so the reason sits on its wrapper. */}
      <span title={reason}>
        <Button variant="outline" size={size} disabled={!!reason} onClick={() => setOpen(true)}>
          <BriefcaseBusiness className="mr-2 h-4 w-4" />
          Add to a job
        </Button>
      </span>
      <AddCandidatesToJobDialog open={open} onOpenChange={setOpen} candidateIds={[candidate.id]} jobs={jobs} />
    </>
  );
}
