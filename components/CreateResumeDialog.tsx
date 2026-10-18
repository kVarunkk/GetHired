"use client";

import { Loader2, Plus } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Button } from "./ui/button";
import AgentHandoff from "./agent/AgentHandoff";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { resumeUploadHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { startTransition, useState } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import { useProgress } from "react-transition-progress";
import { TResumeReviewResume } from "@/utils/types/review.types";

export default function CreateResumeDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const router = useRouter();
  const startProgress = useProgress();

  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  const handleStartProcessing = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const result = await uploadResumeAction(formData);

      if (result.success && result.resumeId) {
        toast.success("Resume added succesfully!");
        setIsOpen(false);
        setSelectedFile(null);
        startTransition(() => {
          startProgress();
          router.push(`/resume/${result.resumeId}`);
        });
      } else {
        throw new Error(result.error);
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again later.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="brand" className="max-w-full">
          <Plus className="w-4 h-4" />
          <span className="truncate">Add Resume</span>
        </Button>
      </ResponsiveDialogTrigger>

      <ResponsiveDialogContent className="sm:max-w-[440px] ">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Add New Resume
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Upload a PDF version of your resume. Our AI will index it for
            further analysis.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {isUploading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4 animate-in fade-in duration-300">
              <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />

              <p className="text-sm text-muted-foreground">Processing Upload</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <AgentHandoff
                label="Or upload it in chat and let the agent use it"
                placeholder="Then make it my primary resume and find matching jobs…"
                basePath={AGENT_PATH}
                toPrompt={resumeUploadHandoffPrompt}
                onHandoff={() => setIsOpen(false)}
              />
              <ResumeSourceSelector
                existingResumes={existingResumes}
                selectedId={null}
                onSelectExisting={() => {}}
                file={selectedFile}
                onFileChange={(file) => setSelectedFile(file)}
                view="upload"
              />
            </div>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            onClick={() => {
              handleStartProcessing();
            }}
            disabled={!selectedFile || isUploading}
            variant="brand"
            className="w-full"
          >
            {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
            Upload Resume
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
