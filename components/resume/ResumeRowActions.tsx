"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Download, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteResumeDialog from "./DeleteResumeDialog";
import { useResumeActions } from "./use-resume-actions";

/**
 * A resume's actions in the list (RE-REQ-030). A version 1 resume that failed
 * to parse has nothing to edit, copy or download until it's uploaded again, so
 * only Delete shows.
 */
export default function ResumeRowActions({
  resume,
  deleteBlocked = null,
  onDeleted,
}: {
  resume: { id: string; name: string | null; isUnreadable: boolean };
  /** Why Delete is off (`resumeDeleteBlockedReason`), shown under it; null when it's allowed. */
  deleteBlocked?: string | null;
  onDeleted: (id: string) => void;
}) {
  const { isBusy, copy, download } = useResumeActions(resume.id);
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isBusy} aria-label={`Actions for ${resume.name ?? "resume"}`}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!resume.isUnreadable && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/resume/${resume.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copy}>
                <Copy className="h-4 w-4" />
                Make a copy
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => download("pdf")}>
                <Download className="h-4 w-4" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => download("docx")}>
                <Download className="h-4 w-4" />
                Download Word
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem disabled={deleteBlocked !== null} onSelect={() => setIsConfirming(true)}>
            <Trash2 className="h-4 w-4" />
            {deleteBlocked ? (
              <span className="flex flex-col">
                Delete
                <span className="text-xs text-muted-foreground">{deleteBlocked}</span>
              </span>
            ) : (
              "Delete"
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteResumeDialog
        resume={resume}
        open={isConfirming}
        onOpenChange={setIsConfirming}
        onDeleted={onDeleted}
      />
    </>
  );
}
