"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RESUME_FILE_ACCEPT, resumeFileProblem } from "@/helpers/resume/config";

/**
 * RE-REQ-098/103: a resume whose file couldn't be re-parsed and which has no
 * content can't be edited, copied or exported. It needs a new file, and
 * `replaceResumeId` keeps the row, so its reviews and applications still point
 * at the same resume. Shown once at the top of the list, however many resumes
 * need it.
 */
export default function ResumeReuploadPrompt({
  resume,
  onUploaded,
}: {
  /** The resume to ask for again, or null when there's nothing to ask for. */
  resume: { id: string; name: string | null } | null;
  /** The page's own refresh, when the caller has one. */
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !resume) return;

    const problem = resumeFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("replaceResumeId", resume.id);
    const result = await uploadResumeAction(formData).catch(() => null);
    setIsUploading(false);

    if (result?.success) {
      toast.success("Resume updated.");
      if (onUploaded) onUploaded();
      else router.refresh();
    } else {
      setError(result?.error ?? "Upload failed. Please try again.");
    }
  };

  if (!resume) return null;

  return (
    <Alert>
      <AlertTitle>Upload {resume.name ?? "this resume"} again</AlertTitle>
      <AlertDescription>
        <p>
          We couldn&apos;t read its file, so there&apos;s nothing to edit or export. Upload it again
          to keep its reviews and applications, or start a new one from{" "}
          <Link href="/resume" className="underline">
            your resumes
          </Link>
          .
        </p>
        <div className="mt-3 max-w-sm">
          <Label htmlFor={`resume-reupload-${resume.id}`}>Resume file</Label>
          <Input
            id={`resume-reupload-${resume.id}`}
            type="file"
            accept={RESUME_FILE_ACCEPT}
            className="mt-1"
            disabled={isUploading}
            onChange={onFile}
          />
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {isUploading && (
          <Button type="button" variant="ghost" size="sm" disabled className="mt-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading your resume…
          </Button>
        )}
        {!isUploading && !error && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Upload className="h-3 w-3" /> PDF or Word, up to 2 MB.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
