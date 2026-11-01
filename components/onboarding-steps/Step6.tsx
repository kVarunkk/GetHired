import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { AlertCircle, Loader2 } from "lucide-react";
import ResumeSourceSelector from "../ResumeSourceSelector";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
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
        ) : (
          <ResumeSourceSelector
            existingResumes={existingResumes}
            selectedId={formData.resume_id || null}
            onSelectExisting={(id: string | null) => {
              setFormData((prev) => ({
                ...prev,
                resume_id: id,
                use_claim_resume: id ? false : prev.use_claim_resume,
              }));
            }}
            file={formData.resume_file || null}
            onFileChange={(file: File | null) => {
              setFormData((prev) => ({
                ...prev,
                resume_file: file,
                use_claim_resume: file ? false : prev.use_claim_resume,
              }));
            }}
            showManageResumes={false}
          />
        )}

        {errors.resume_file && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {errors.resume_file}
          </p>
        )}
      </div>
    </CardContent>
  );
};
