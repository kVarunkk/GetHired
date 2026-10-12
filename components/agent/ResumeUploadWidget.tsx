"use client";

import { useId, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

export type ResumeUploadOutput = { resumeId: string } | { cancelled: true };

/** Upload widget shown for the agent's requestResumeUpload tool (REQ-015). */
export default function ResumeUploadWidget({
  reason,
  onComplete,
}: {
  reason?: string;
  onComplete: (output: ResumeUploadOutput) => void;
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const chooseFile = (selected: File | undefined) => {
    setFile(null);
    setError(null);
    if (!selected) return;
    if (selected.type !== "application/pdf") {
      setError("Only PDF files are supported.");
    } else if (selected.size > MAX_SIZE_BYTES) {
      setError("The file must be 2MB or smaller.");
    } else {
      setFile(selected);
    }
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadResumeAction(formData);
      if (result.success && result.resumeId) {
        onComplete({ resumeId: result.resumeId });
      } else {
        setError(result.error ?? "Upload failed. Please try again.");
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brandSoft p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileUp className="h-4 w-4" />
        Upload your resume
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      <label htmlFor={inputId} className="sr-only">
        Resume PDF
      </label>
      <input
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        disabled={uploading}
        onChange={(event) => chooseFile(event.target.files?.[0])}
        className="w-full cursor-pointer rounded-lg border border-dashed border-brand/40 bg-background p-3 text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="brand"
          onClick={upload}
          disabled={!file || uploading}
        >
          {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={uploading}
          onClick={() => onComplete({ cancelled: true })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
