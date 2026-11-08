"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Download, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { deleteResumeAction } from "@/app/actions/resumes/delete-resume";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResumeActions } from "./use-resume-actions";

/**
 * A resume's actions in the list (RE-REQ-030). A version 1 resume that failed
 * to parse has nothing to edit, copy or download until it's uploaded again, so
 * only Delete shows.
 */
export default function ResumeRowActions({
  resume,
  canDelete,
  isPrimary = false,
  onDeleted,
}: {
  resume: { id: string; name: string | null; isUnreadable: boolean };
  /** False for the user's last resume (RE-REQ-037) and their primary one. */
  canDelete: boolean;
  /** Says why Delete is off: another resume has to be made primary first. */
  isPrimary?: boolean;
  onDeleted: (id: string) => void;
}) {
  const { isBusy, copy, download } = useResumeActions(resume.id);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    setIsDeleting(true);
    const result = await deleteResumeAction({ resumeId: resume.id }).catch(() => null);
    setIsDeleting(false);

    if (result?.ok) {
      setIsConfirming(false);
      toast.success("Resume deleted.");
      onDeleted(resume.id);
    } else {
      toast.error(result?.error ?? "We couldn't delete this resume. Please try again.");
    }
  };

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
          <DropdownMenuItem disabled={!canDelete} onSelect={() => setIsConfirming(true)}>
            <Trash2 className="h-4 w-4" />
            {isPrimary ? (
              <span className="flex flex-col">
                Delete
                <span className="text-xs text-muted-foreground">Make another resume primary first</span>
              </span>
            ) : (
              "Delete"
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isConfirming} onOpenChange={setIsConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {resume.name ?? "this resume"}?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={isDeleting} onClick={confirmDelete}>
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete resume
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
