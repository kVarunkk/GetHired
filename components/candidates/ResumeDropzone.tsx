"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_RESUME_FILES, RESUME_ACCEPT, resumeFileError } from "@/helpers/candidates/resume-files";
import { cn } from "@/utils/utils";

const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * BI-REQ-020: choose or drop up to 100 resumes (PDF or DOCX, 10 MB each).
 * Wrong types and oversized files are listed with the reason and never
 * uploaded. `onSubmit` gets the files that pass.
 */
export default function ResumeDropzone({
  onSubmit,
  busy = false,
  progress,
  error,
}: {
  onSubmit: (files: File[]) => void;
  busy?: boolean;
  /** "Uploading 3 of 12" while files go to Storage. */
  progress?: string | null;
  /** The upload or allowance result, e.g. "Your plan covers 20 of these 30 resumes." */
  error?: string | null;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
      return [...current, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const rejected = new Map(files.map((f) => [f, resumeFileError(f)] as const));
  const accepted = files.filter((f) => !rejected.get(f));
  const tooMany = accepted.length > MAX_RESUME_FILES;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) add(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center",
          dragging && "border-primary bg-muted/50",
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold">Drop resumes here</p>
          <p className="text-sm text-muted-foreground">
            PDF or Word (.docx), up to {MAX_RESUME_FILES} at a time, 10 MB each. Each resume read uses one resume import.
          </p>
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={RESUME_ACCEPT}
          className="sr-only"
          aria-label="Choose resumes"
          disabled={busy}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border" aria-label="Chosen resumes">
          {files.map((file) => {
            const reason = rejected.get(file);
            return (
              <li key={`${file.name}:${file.size}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {reason ? (
                  <span className="text-destructive">{reason}</span>
                ) : (
                  <span className="text-muted-foreground">{sizeOf(file.size)}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={busy}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((f) => f !== file))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {tooMany && (
        <p className="text-sm text-destructive">
          Import at most {MAX_RESUME_FILES} resumes at a time. Remove {accepted.length - MAX_RESUME_FILES}.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
        <Button type="button" disabled={busy || accepted.length === 0 || tooMany} onClick={() => onSubmit(accepted)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Upload and read {accepted.length === 1 ? "1 resume" : `${accepted.length} resumes`}
        </Button>
      </div>
    </div>
  );
}
