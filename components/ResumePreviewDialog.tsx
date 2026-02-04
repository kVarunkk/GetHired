"use client";

import OriginalResumeWrapper from "./OriginalResumeWrapper";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { FileText } from "lucide-react";

export default function ResumePreviewDialog({
  displayUrl,
}: {
  displayUrl: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
        >
          <FileText className="w-4 h-4" />
          View
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[90vw] h-[90vh] rounded-xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Resume Preview</DialogTitle>
        </DialogHeader>
        <div className="h-full overflow-y-auto">
          <OriginalResumeWrapper url={displayUrl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
