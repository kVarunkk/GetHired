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
import { createResumeAction } from "@/app/actions/resumes/create-resume";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import { useProgress } from "react-transition-progress";
import { TResumeReviewResume } from "@/utils/types/review.types";

export default function CreateResumeDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();
  const startProgress = useProgress();

  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  const openEditor = (resumeId: string) => {
    setIsOpen(false);
    setSelectedFile(null);
    startTransition(() => {
      startProgress();
      router.push(`/resume/${resumeId}/edit`);
    });
  };

  const handleStartBlank = async () => {
    if (isCreating) return;

    setIsCreating(true);
    setUploadError(null);
    const result = await createResumeAction().catch(() => null);
    setIsCreating(false);

    if (result?.ok) openEditor(result.resumeId);
    else setUploadError(result?.error ?? "We couldn't create this resume. Please try again.");
  };

  const handleStartProcessing = async () => {
    if (!selectedFile || isUploading) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const result = await uploadResumeAction(formData);

      if (result.success && result.resumeId) {
        toast.success("Resume added. Check it over.");
        // RE-REQ-020: the parse opens in the editor.
        openEditor(result.resumeId);
      } else {
        setUploadError(result.error ?? "Upload failed. Please try again.");
      }
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="brand" className="max-w-full">
          <Plus className="w-4 h-4" />
          <span>New resume</span>
        </Button>
      </ResponsiveDialogTrigger>

      <ResponsiveDialogContent className="sm:max-w-[440px] ">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            New resume
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Upload a PDF or Word file and we&apos;ll read it into a resume you
            can edit, without keeping the file. Or start blank.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {isUploading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4 animate-in fade-in duration-300">
              <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />

              <p className="text-sm text-muted-foreground">
                Reading your resume. This can take a few seconds.
              </p>
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
                onFileChange={(file) => {
                  setSelectedFile(file);
                  setUploadError(null);
                }}
                view="upload"
              />
              {uploadError && (
                <p role="alert" className="text-sm text-destructive">
                  {uploadError}
                </p>
              )}
            </div>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            onClick={handleStartBlank}
            disabled={isUploading || isCreating}
            variant="outline"
            className="w-full"
          >
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            Start blank
          </Button>
          <Button
            onClick={() => {
              handleStartProcessing();
            }}
            disabled={!selectedFile || isUploading || isCreating}
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
