import React from "react";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "./ui/badge";

/**
 * ResumeStatusBadge
 * Uses the status badge variants (design-system.md §1).
 */
export default function ResumeStatusBadge({
  isParsed,
  isParsingFailed,
}: {
  isParsed: boolean;
  isParsingFailed: boolean;
}) {
  // 1. FAILED STATE
  if (isParsingFailed) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 rounded-full px-2 border-destructive/30 bg-destructive/10 text-destructive"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        <span>Sync Failed</span>
      </Badge>
    );
  }

  // 2. SUCCESS STATE (Indexed)
  if (isParsed) {
    return (
      <Badge variant="success" className="gap-1.5 rounded-full px-2">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Indexed</span>
      </Badge>
    );
  }

  // 3. LOADING STATE (Default/Processing)
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 rounded-full px-2 text-muted-foreground animate-pulse"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>Indexing...</span>
    </Badge>
  );
}
