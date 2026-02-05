import { useEffect, useState } from "react";
import { StepProps } from "../OnboardingComponent";
import { createClient } from "@/lib/supabase/client";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import { Loader2 } from "lucide-react";
import ResumeSourceSelector from "../ResumeSourceSelector";
import { IResume } from "@/lib/types";

export const Step6ResumeUpload: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => {
  const [existingResumes, setExistingResumes] = useState<IResume[]>([]);
  const [fetchingResumes, setFetchingResumes] = useState(true);

  useEffect(() => {
    const fetchResumes = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setFetchingResumes(false);
          return;
        }

        const { data, error } = await supabase
          .from("resumes")
          .select("id, name, created_at, is_primary")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (!error) {
          setExistingResumes((data || []) as IResume[]);
        }
      } catch (err) {
        console.error("Error fetching resumes:", err);
      } finally {
        setFetchingResumes(false);
      }
    };

    fetchResumes();
  }, []);

  return (
    <CardContent className="!p-0 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <Label>Professional Resume</Label>
        </div>

        {fetchingResumes ? (
          <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-xl border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
            <Loader2 className="animate-spin h-5 w-5 " />
          </div>
        ) : (
          <ResumeSourceSelector
            existingResumes={existingResumes}
            selectedId={formData.resume_id || null}
            onSelectExisting={(id: string | null) => {
              setFormData((prev) => ({
                ...prev,
                resume_id: id,
              }));
            }}
            file={formData.resume_file || null}
            onFileChange={(file: File | null) => {
              setFormData((prev) => ({
                ...prev,
                resume_file: file,
              }));
            }}
          />
        )}

        {errors.resume_file && (
          <p className="text-red-500 text-xs font-medium bg-red-500/10 p-2 rounded-md border border-red-500/20">
            {errors.resume_file}
          </p>
        )}
      </div>
    </CardContent>
  );
};
