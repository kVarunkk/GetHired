"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { cn } from "@/utils/utils";
import { formatDate } from "@/utils/date";
import { AlertTriangle, CheckCircle2, FileCheck, Search, Star } from "lucide-react";

/** Below this many resumes the whole list fits, so there's no search box. */
export const RESUME_SEARCH_THRESHOLD = 5;

type SelectableResume = TResumeReviewResume & { resume_path?: string | null };

/** Primary first, then newest first. */
export function sortResumes<T extends SelectableResume>(resumes: T[]): T[] {
  return [...resumes].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export const SelectResumeParent = ({
  existingResumes,
  onFileChange,
  onSelectExisting,
  selectedId,
}: {
  existingResumes: SelectableResume[];
  onFileChange: (file: File | null) => void;
  onSelectExisting: (id: string | null) => void;
  selectedId: string | null;
}) => {
  const [query, setQuery] = useState("");
  const sorted = useMemo(
    () => sortResumes(existingResumes ?? []),
    [existingResumes],
  );
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? sorted.filter((r) => (r.name || "").toLowerCase().includes(needle))
    : sorted;
  const showSearch = sorted.length > RESUME_SEARCH_THRESHOLD;

  if (sorted.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No existing resumes. Upload new.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${sorted.length} resumes`}
            aria-label="Search resumes"
            className="pl-9"
          />
        </div>
      )}
      {/* The search box stays put while the list scrolls under it. */}
      <div
        role="listbox"
        aria-label="Your resumes"
        className="max-h-[300px] space-y-1.5 overflow-y-auto overflow-x-hidden pb-1 pr-1"
      >
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No resumes match &ldquo;{query.trim()}&rdquo;.
          </div>
        ) : (
          visible.map((resume) => {
            const selected = selectedId === resume.id;
            return (
              <button
                title={resume.name || ""}
                key={resume.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onFileChange(null);
                  onSelectExisting(resume.id);
                }}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-200",
                  selected
                    ? "border-brand bg-brandSoft"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                <FileCheck
                  size={16}
                  className={cn(
                    "shrink-0 transition-colors duration-200",
                    selected
                      ? "text-brand"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <p className="min-w-0 truncate text-sm font-semibold">
                    {resume.name}
                  </p>
                  {/* Icons, not badges: a badge's width squeezed the name. */}
                  {resume.is_primary && (
                    <Star
                      size={14}
                      role="img"
                      aria-label="Primary resume"
                      className="shrink-0 fill-brand text-brand"
                    >
                      <title>Primary resume</title>
                    </Star>
                  )}
                  {resume.parsing_failed && (
                    <AlertTriangle
                      size={14}
                      role="img"
                      aria-label="Couldn't read this resume"
                      className="shrink-0 text-destructive"
                    >
                      <title>Couldn&apos;t read this resume</title>
                    </AlertTriangle>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(resume.created_at)}
                </span>
                {/* Always mounted, so selecting fades it in with the row's colours. */}
                <CheckCircle2
                  size={16}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-brand transition-all duration-200",
                    selected ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  )}
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
