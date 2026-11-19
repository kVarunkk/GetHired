"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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

/** The confirm before deleting a resume, shared by the list and the resume page (RE-REQ-037). */
export default function DeleteResumeDialog({
  resume,
  open,
  onOpenChange,
  onDeleted,
}: {
  resume: { id: string; name: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    setIsDeleting(true);
    const result = await deleteResumeAction({ resumeId: resume.id }).catch(() => null);
    setIsDeleting(false);

    if (result?.ok) {
      onOpenChange(false);
      toast.success("Resume deleted.");
      onDeleted(resume.id);
    } else {
      toast.error(result?.error ?? "We couldn't delete this resume. Please try again.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
  );
}
