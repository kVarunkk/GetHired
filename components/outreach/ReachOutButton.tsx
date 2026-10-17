"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { outreachPath } from "@/helpers/outreach/config";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import OutreachComposer from "./OutreachComposer";
import OutreachStatusBadge from "./OutreachStatusBadge";

/**
 * The profile page's main action (OR-TASK-003): the outreach status and "Reach
 * out". `secondaryAction` sits between them, so the status leads the row and
 * isn't wedged between two buttons. The status links to the outreach's page.
 */
export default function ReachOutButton({
  candidateId,
  candidateName,
  status,
  outreachId,
  defaultJobPostId,
  secondaryAction,
}: {
  candidateId: string;
  candidateName: string | null;
  status: OutreachStatus | null;
  /** The latest outreach the status belongs to. */
  outreachId?: string | null;
  defaultJobPostId?: string | null;
  secondaryAction?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(status);
  const [currentId, setCurrentId] = useState(outreachId ?? null);

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      {current && currentId ? (
        <Link href={outreachPath(currentId)} title="Open the latest outreach" className="shrink-0">
          <OutreachStatusBadge status={current} />
        </Link>
      ) : (
        <OutreachStatusBadge status={current} className="shrink-0" />
      )}
      {secondaryAction}
      <Button variant="brand" size="sm" onClick={() => setOpen(true)}>
        <Send className="h-4 w-4" />
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
          setCurrentId(outreach.id);
          router.refresh();
        }}
      />
    </div>
  );
}
