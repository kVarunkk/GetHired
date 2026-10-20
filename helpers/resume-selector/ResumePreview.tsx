import ResumePreviewDialog from "@/components/ResumePreviewDialog";
import { Loader2 } from "lucide-react";

/**
 * Stays mounted while the selection changes: only the name and the View
 * button swap, so picking another resume doesn't make the layout jump.
 */
export const ResumePreview = ({
  previewUrl,
  name,
}: {
  /** null while the signed URL loads. */
  previewUrl: string | null;
  name: string | null;
}) => {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Selected resume
        </span>
        <span className="truncate text-sm font-medium">{name}</span>
      </div>
      <div className="shrink-0 rounded-md border bg-background px-2 py-1 text-xs">
        {previewUrl ? (
          <ResumePreviewDialog displayUrl={previewUrl} />
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            View
          </span>
        )}
      </div>
    </div>
  );
};
