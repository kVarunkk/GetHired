"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { uploadCandidateResume } from "@/components/candidates/upload-candidate-resume";
import { Button } from "@/components/ui/button";
import type { CandidateResumeWarning } from "@/helpers/candidates/parse-candidate-resume";
import { RESUME_ACCEPT } from "@/helpers/candidates/resume-files";
import { TARGET_LABELS } from "@/helpers/candidates/map-columns";

/**
 * BI-REQ-008: uploads a resume for a candidate. The file goes straight to
 * Storage; the server reads it, fills only the candidate's empty fields
 * (uses one resume import), replaces the old file and screens their open
 * applications again. What it couldn't use is listed.
 */
export default function CandidateResumeUpload({
  candidateId,
  hasResume,
}: {
  candidateId: string;
  hasResume: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<CandidateResumeWarning[]>([]);

  const upload = async (file: File) => {
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      const result = await uploadCandidateResume(candidateId, file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarnings(result.warnings);
      toast.success(
        result.rescreened > 0
          ? `Resume saved. Screening ${result.rescreened === 1 ? "their application" : `${result.rescreened} applications`} again.`
          : "Resume saved.",
      );
      router.refresh();
    } catch {
      setError("Couldn't upload the resume. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={RESUME_ACCEPT}
        className="sr-only"
        aria-label="Choose a resume"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {busy ? "Reading the resume…" : hasResume ? "Replace resume" : "Upload resume"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        PDF or Word (.docx), up to 10 MB. Uses one resume import. Only empty details are filled in from it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border p-3 text-sm" role="status">
          <p className="font-medium">Some details weren&apos;t used:</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {warnings.map((w) => (
              <li key={w.field}>
                {TARGET_LABELS[w.field as keyof typeof TARGET_LABELS] ?? w.field}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
