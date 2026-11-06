"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { upgradeResumeAction } from "@/app/actions/resumes/upgrade-resume";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RESUME_FILE_ACCEPT, resumeFileProblem } from "@/helpers/resume/config";

const UPGRADE_FAILED = "We couldn't update this resume to the new format. Upload it again to keep editing.";

/**
 * Opening a version 1 resume in the editor upgrades it first (RE-REQ-095). The
 * page re-renders with the editor once that's done. A failed upgrade offers a
 * re-upload over the same resume, which keeps its reviews.
 */
export default function ResumeUpgradeGate({ resumeId }: { resumeId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    upgradeResumeAction({ resumeId })
      .then((result) => {
        if (result.ok) router.refresh();
        else setError(result.error);
      })
      .catch(() => setError(UPGRADE_FAILED));
  }, [resumeId, router]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const problem = resumeFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("replaceResumeId", resumeId);
    const result = await uploadResumeAction(formData).catch(() => null);
    setIsUploading(false);

    if (result?.success) router.refresh();
    else setError(result?.error ?? "Upload failed. Please try again.");
  };

  if (!error) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Updating this resume to the new format. This can take a few seconds.
      </div>
    );
  }

  return (
    <Alert>
      <AlertTitle>This resume needs uploading again</AlertTitle>
      <AlertDescription>
        <p role="alert">{error}</p>
        <div className="mt-3">
          <Label htmlFor="resume-reupload">Resume file</Label>
          <Input
            id="resume-reupload"
            type="file"
            accept={RESUME_FILE_ACCEPT}
            className="mt-1"
            disabled={isUploading}
            onChange={onFile}
          />
        </div>
        {isUploading && (
          <Button type="button" variant="ghost" size="sm" disabled className="mt-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading your resume…
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
