import React from "react";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

/**
 * ResumeStatusBadge
 * Uses the project's semantic brand colors for consistency.
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
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-[10px] font-black uppercase tracking-tighter text-red-600 dark:text-red-400">
        <AlertCircle size={12} />
        <span>Sync Failed</span>
      </div>
    );
  }

  // 2. SUCCESS STATE (Indexed)
  if (isParsed) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brandSoft border border-brand/10 text-[10px] font-black uppercase tracking-tighter text-brand">
        <CheckCircle2 size={12} />
        <span>Indexed</span>
      </div>
    );
  }

  // 3. LOADING STATE (Default/Processing)
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase tracking-tighter text-zinc-500 animate-pulse">
      <Loader2 size={12} className="animate-spin" />
      <span>Indexing...</span>
    </div>
  );
}
