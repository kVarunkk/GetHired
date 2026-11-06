import { useState } from "react";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { AlertCircle, Loader2 } from "lucide-react";
import ResumeSourceSelector from "../ResumeSourceSelector";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import useSWR from "swr";

export const Step6ResumeUpload: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => {
  const { data, isLoading } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];
  const [uploadError, setUploadError] = useState<string | null>(null);

  // RE-REQ-021: parsed when added, so the final submit doesn't wait. A new
  // file replaces the row this form already made, so only one is left.
  const parseFile = async (file: File) => {
    setUploadError(null);
    setFormData((prev) => ({
      ...prev,
      resume_file: file,
      resume_id: null,
      resume_parsing: true,
      use_claim_resume: false,
    }));

    let resumeId: string | null = null;
    let problem: string | null = null;
    try {
      const upload = new FormData();
      upload.append("file", file);
      if (formData.uploaded_resume_id) {
        upload.append("replaceResumeId", formData.uploaded_resume_id);
      }
      const result = await uploadResumeAction(upload);
      if (result.success && result.resumeId) resumeId = result.resumeId;
      else problem = result.error ?? "Upload failed. Please try again.";
    } catch {
      problem = "Upload failed. Please try again.";
    }

    setUploadError(problem);
    setFormData((prev) => ({
      ...prev,
      resume_parsing: false,
      resume_file: resumeId ? file : null,
      resume_id: resumeId,
      uploaded_resume_id: resumeId ?? prev.uploaded_resume_id,
    }));
  };

  const onFileChange = (file: File | null) => {
    if (file) {
      void parseFile(file);
      return;
    }
    setUploadError(null);
    setFormData((prev) => ({
      ...prev,
      resume_file: null,
      // Removing the file un-picks its resume. The row stays for a replace.
      resume_id: prev.resume_file ? null : prev.resume_id,
    }));
  };

  return (
    <CardContent className="!p-0 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <Label>Professional Resume*</Label>
        </div>

        {formData.claim_resume_name && (
          <div className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              id="use-claim-resume"
              checked={formData.use_claim_resume}
              disabled={formData.resume_parsing}
              onCheckedChange={(checked) => {
                // BIT-105: one resume at a time, so choosing this clears the others.
                setFormData((prev) => ({
                  ...prev,
                  use_claim_resume: checked === true,
                  ...(checked === true ? { resume_id: null, resume_file: null } : {}),
                }));
              }}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="use-claim-resume">Use {formData.claim_resume_name}</Label>
              <p className="text-sm text-muted-foreground">
                A copy is added to your resumes when you submit. Or choose another below.
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-xl bg-muted/40">
            <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
          </div>
        ) : formData.resume_parsing ? (
          <div className="h-32 flex flex-col gap-2 items-center justify-center border-2 border-dashed rounded-xl bg-muted/40">
            <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Reading your resume. This can take a few seconds.
            </p>
          </div>
        ) : (
          <ResumeSourceSelector
            existingResumes={existingResumes}
            selectedId={formData.resume_file ? null : formData.resume_id || null}
            onSelectExisting={(id: string | null) => {
              setFormData((prev) => ({
                ...prev,
                resume_id: id,
                use_claim_resume: id ? false : prev.use_claim_resume,
              }));
            }}
            file={formData.resume_file || null}
            onFileChange={onFileChange}
            showManageResumes={false}
          />
        )}

        {(uploadError || errors.resume_file) && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {uploadError ?? errors.resume_file}
          </p>
        )}
      </div>
    </CardContent>
  );
};
