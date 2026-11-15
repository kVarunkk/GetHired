"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import InviteToInterviewDialog from "./InviteToInterviewDialog";

/**
 * Invites one application to the AI interview, from the application's AI
 * interview section. Rendered only with interviews.manage on the job; the
 * server checks again.
 */
export default function InviteToInterviewButton({
  applicationId,
  jobPostId,
  candidateName,
  durationMinutes,
  enabled,
}: {
  applicationId: string;
  jobPostId: string;
  candidateName: string;
  durationMinutes: number;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" size="sm" onClick={() => setOpen(true)}>
        <Mic className="h-4 w-4" />
        Invite to AI interview
      </Button>
      <InviteToInterviewDialog
        open={open}
        onOpenChange={setOpen}
        jobPostId={jobPostId}
        applicationIds={[applicationId]}
        nameOf={() => candidateName}
        durationMinutes={durationMinutes}
        enabled={enabled}
      />
    </>
  );
}
