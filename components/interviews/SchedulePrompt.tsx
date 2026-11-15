"use client";

import Link from "next/link";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { schedulePath, type PromptItem } from "@/helpers/interviews/schedule-prompt";

/**
 * D8 (IVT-072): after a move into a stage with plan interviews, a link per
 * interview to the scheduler, opened on it. Dismissible; nothing is sent.
 */
export default function SchedulePrompt({
  applicationId,
  items,
  candidateName,
  onDismiss,
}: {
  applicationId: string;
  items: PromptItem[];
  /** On the board, whose card moved. */
  candidateName?: string;
  onDismiss: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={candidateName ? `Schedule interviews for ${candidateName}` : "Schedule interviews"}
      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {candidateName && <span className="font-medium">{candidateName}</span>}
      {items.map((item) => (
        <Button key={item.id} asChild size="sm" variant="outline">
          <Link href={schedulePath(applicationId, item.id)}>Schedule {item.name}</Link>
        </Button>
      ))}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Dismiss" onClick={onDismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
