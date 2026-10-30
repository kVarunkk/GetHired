"use client";

import { useId, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadCandidateResume } from "@/components/candidates/upload-candidate-resume";
import { RESUME_ACCEPT, resumeFileError } from "@/helpers/candidates/resume-files";

export type CandidateResumeOutput = { uploaded: true; rescreened: number } | { cancelled: true };

/**
 * The recruiter agent's `requestCandidateResume` (BI-REQ-008/060): one
 * resume for one of the company's candidates, read in as the candidate
 * page's "Upload resume" does (fills only empty fields, uses one resume
 * import, screens their open applications again).
 */
export default function CandidateResumeWidget({
  candidateId,
  reason,
  onComplete,
}: {
  candidateId: string;
  reason?: string;
  onComplete: (output: CandidateResumeOutput) => void;
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = (selected: File | undefined) => {
    setFile(null);
    setError(null);
    if (!selected) return;
    const problem = resumeFileError(selected);
    if (problem) setError(problem);
    else setFile(selected);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadCandidateResume(candidateId, file);
      if (result.ok) onComplete({ uploaded: true, rescreened: result.rescreened });
      else setError(result.error);
    } catch {
      setError("Couldn't upload the resume. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brandSoft p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileUp className="h-4 w-4" />
        Add their resume
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      <label htmlFor={inputId} className="sr-only">
        Resume (PDF or Word)
      </label>
      <input
        id={inputId}
        type="file"
        accept={RESUME_ACCEPT}
        disabled={busy}
        onChange={(event) => choose(event.target.files?.[0])}
        className="w-full cursor-pointer rounded-lg border border-dashed border-brand/40 bg-background p-3 text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed"
      />
      <p className="text-xs text-muted-foreground">
        PDF or Word (.docx), up to 10 MB. Uses one resume import. Only empty details are filled in from it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="brand" onClick={upload} disabled={!file || busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Reading the resume…" : "Upload"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onComplete({ cancelled: true })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
