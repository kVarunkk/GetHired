"use client";

import OriginalResumeWrapper from "./OriginalResumeWrapper";
import ResumePreview from "@/components/resume/ResumePreview";
import type { ResumeDocument } from "@/helpers/resume/render/document";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { FileText } from "lucide-react";

type Options = {
  /** The dialog's title. */
  title?: string;
  /** The trigger's accessible name, when "View" alone isn't enough (a list of files). */
  triggerLabel?: string;
  /** Told when the dialog opens or closes, e.g. to fetch a signed URL only on open. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Shows a stored file, or a resume built in the editor (no file). A
 * `displayUrl` of "" keeps the loading placeholder up until it arrives.
 */
export default function ResumePreviewDialog(
  props: ({ displayUrl: string } | { document: ResumeDocument }) & Options,
) {
  return (
    <ResponsiveDialog onOpenChange={props.onOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <button
          type="button"
          aria-label={props.triggerLabel}
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
          <ResponsiveDialogTitle>{props.title ?? "Resume Preview"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {"displayUrl" in props ? (
          <div className="min-h-0 flex-1">
            <OriginalResumeWrapper url={props.displayUrl} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ResumePreview
              className="mx-auto max-w-3xl"
              document={props.document}
            />
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
