"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import ResumeDropzone from "@/components/candidates/ResumeDropzone";
import { uploadResumeBatch, useResumeUploadGuard } from "@/components/candidates/upload-resume-batch";

export type ResumeImportOutput = { batchId: string; files: number } | { cancelled: true };

/**
 * The recruiter agent's `requestResumeImport` (BI-REQ-060): the import
 * page's dropzone in the chat. Files go straight to Storage and the batch is
 * submitted for reading, holding one resume import per file; the agent gets
 * the batch id and reviews it with getImport. Nothing is imported until
 * the user approves confirmImport.
 */
export default function ResumeImportWidget({
  jobPostId,
  reason,
  onComplete,
}: {
  jobPostId?: string;
  reason?: string;
  onComplete: (output: ResumeImportOutput) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadGuard = useResumeUploadGuard(busy);

  const upload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const result = await uploadResumeBatch(files, { jobPostId, onProgress: setProgress });
      // The chat that asked is gone, so nobody's waiting for the tool output.
      if (!uploadGuard.isMounted()) return uploadGuard.finishedAway(result, files.length);
      if (result.ok) onComplete({ batchId: result.batchId, files: files.length });
      else setError(result.error);
    } catch {
      if (!uploadGuard.isMounted()) return uploadGuard.finishedAway(null, files.length);
      setError("Couldn't upload the resumes. Try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brandSoft p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileUp className="h-4 w-4" />
        Import resumes
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      <div className="rounded-lg bg-background p-3">
        <ResumeDropzone onSubmit={(files) => void upload(files)} busy={busy} progress={progress} error={error} />
      </div>
      <div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onComplete({ cancelled: true })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
