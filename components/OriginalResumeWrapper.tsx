"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Mirrors the viewer's own loading state (toolbar row + page placeholder), so the
// hand-off from this to the viewer doesn't jump or flash.
function ViewerPlaceholder() {
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="py-3 border-b border-border">
        <div className="h-8" />
      </div>
      <div className="flex-1 overflow-hidden p-6 bg-muted/30 [scrollbar-gutter:stable]">
        <div
          role="status"
          aria-label="Loading resume"
          className="mx-auto flex w-[calc(100%-10px)] aspect-[8.5/11] items-center justify-center rounded-sm border bg-muted"
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

const OriginalResumeViewer = dynamic(
  () => import("@/components/OriginalResumeViewer"),
  { ssr: false, loading: ViewerPlaceholder },
);

export default function OriginalResumeWrapper({ url }: { url: string }) {
  return <OriginalResumeViewer url={url} />;
}
