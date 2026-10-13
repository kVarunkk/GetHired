"use client";

import OriginalResumeWrapper from "./OriginalResumeWrapper";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { FileText } from "lucide-react";

export default function ResumePreviewDialog({
  displayUrl,
}: {
  displayUrl: string;
}) {
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium underline-offset-4 transition-colors hover:text-brand hover:underline"
        >
          <FileText className="w-4 h-4" />
          View
        </button>
      </ResponsiveDialogTrigger>
      {/* A flex column gives the viewer a fixed height; the viewer does its own scrolling. */}
      <ResponsiveDialogContent
        className="flex h-[90vh] max-w-[90vw] flex-col overflow-hidden"
        drawerClassName="h-[85dvh] overflow-hidden"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Resume Preview</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="min-h-0 flex-1">
          <OriginalResumeWrapper url={displayUrl} />
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
