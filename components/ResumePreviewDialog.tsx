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
          className="inline-flex items-center gap-1 font-medium underline-offset-4 transition-colors hover:text-brand hover:underline"
        >
          <FileText className="w-4 h-4" />
          View
        </button>
      </DialogTrigger>
      {/* A flex column gives the viewer a fixed height; the viewer does its own scrolling. */}
      <DialogContent className="flex h-[90vh] max-w-[90vw] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Resume Preview</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <OriginalResumeWrapper url={displayUrl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
