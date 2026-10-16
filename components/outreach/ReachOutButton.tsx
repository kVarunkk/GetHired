"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import OutreachComposer from "./OutreachComposer";
import OutreachStatusBadge from "./OutreachStatusBadge";

/** The profile page's main action (OR-TASK-003): the outreach status and "Reach out". */
export default function ReachOutButton({
  candidateId,
  candidateName,
  status,
  defaultJobPostId,
}: {
  candidateId: string;
  candidateName: string | null;
  status: OutreachStatus | null;
  defaultJobPostId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(status);

  return (
    <div className="flex items-center gap-2">
      <OutreachStatusBadge status={current} />
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Send className="mr-2 h-4 w-4" />
        Reach out
      </Button>
      <OutreachComposer
        candidateId={candidateId}
        candidateName={candidateName}
        open={open}
        onOpenChange={setOpen}
        defaultJobPostId={defaultJobPostId}
        onSent={(outreach) => {
          setCurrent(outreach.status as OutreachStatus);
          router.refresh();
        }}
      />
    </div>
  );
}
