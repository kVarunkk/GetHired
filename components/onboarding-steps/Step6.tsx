import { useEffect, useState } from "react";
import { StepProps } from "../OnboardingComponent";
import { createClient } from "@/lib/supabase/client";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import ResumePreviewDialog from "../ResumePreviewDialog";
import { Loader2, X } from "lucide-react";

export const Step6ResumeUpload: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => {
  // State for the signed URL to display
  const [signedDisplayUrl, setSignedDisplayUrl] = useState<string | null>(null);
  const [signedUrlError, setSignedUrlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // State for the local file preview URL (for newly selected files before upload)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // --- Effect to generate signed URL ---
  useEffect(() => {
    const fetchSignedUrl = async () => {
      // Only fetch if resume_url exists (meaning it was previously uploaded and stored)
      if (formData.resume_path) {
        setSignedUrlError(null);
        setSignedDisplayUrl(null); // Clear previous URL

        try {
          const supabase = createClient();

          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();

          if (user === null || userError) {
            setSignedUrlError(
              `Failed to load resume: ${userError ? userError.message : ""}`
            );
          }

          const { data, error } = await supabase.storage
            .from("resumes")
            .createSignedUrl(`${formData.resume_path}`, 3600); // URL valid for 1 hour

          if (error) {
            setSignedUrlError(`Failed to load resume: ${error.message}`);
          } else if (data?.signedUrl) {
            setSignedDisplayUrl(data.signedUrl);
          } else {
            setSignedUrlError("Could not get signed URL for resume.");
          }
        } catch (err: unknown) {
          setSignedUrlError(
            `An unexpected error occurred: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        } finally {
          setLoading(false);
        }
      } else {
        // If formData.resume_url is null, clear any previous signed URL
        setSignedDisplayUrl(null);
        setSignedUrlError(null);
        setLoading(false);
      }
    };

    fetchSignedUrl();
  }, [formData.resume_path]); // Re-run when the Supabase URL changes

  // --- Effect to generate local preview URL for newly selected files ---
  useEffect(() => {
    if (formData.resume_file) {
      // Create a URL for the local file object
      const url = URL.createObjectURL(formData.resume_file);
      setLocalPreviewUrl(url);

      // Clean up the object URL when the component unmounts or the file changes
      return () => URL.revokeObjectURL(url);
    } else {
      setLocalPreviewUrl(null);
    }
  }, [formData.resume_file]); // Re-run when the selected file changes

  return (
    <CardContent className="!p-0">
      <Label htmlFor="resume_file">Upload Your Resume (PDF)</Label>
      <Input
        id="resume_file"
        type="file"
        accept=".pdf"
        onChange={(e) => {
          const file = e.target.files ? e.target.files[0] : null;
          setFormData((prev) => ({
            ...prev,
            resume_file: file, // Store the File object
            resume_name: file ? file.name : null, // Update resume_name immediately
          }));
        }}
        className={cn(
          "mt-2 bg-input",
          errors.resume_file ? "border-red-500 " : ""
        )}
      />
      {errors.resume_file && (
        <p className="text-red-500 text-sm mt-1">{errors.resume_file}</p>
      )}

      {formData.resume_file && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground mt-2">
            Selected file: {formData.resume_file.name}
          </p>

          <button
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                resume_file: null,
                resume_name: null,
              }));
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading && <Loader2 className="animate-spin h-4 w-4 mt-2" />}

      {formData.resume_path && signedDisplayUrl && !signedUrlError && (
        <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
          <ResumePreviewDialog
            displayUrl={signedDisplayUrl}
            // isPdf={signedDisplayUrl.endsWith(".pdf")}
            isPdf
          />
          your currently stored Resume
        </p>
      )}

      {signedUrlError && (
        <p className="text-red-500 text-sm mt-2">{signedUrlError}</p>
      )}

      {formData.resume_file && localPreviewUrl && (
        <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
          <ResumePreviewDialog
            displayUrl={localPreviewUrl}
            // isPdf={localPreviewUrl.endsWith(".pdf")}
            isPdf
          />
          for the Resume you just uploaded
        </p>
      )}
    </CardContent>
  );
};
