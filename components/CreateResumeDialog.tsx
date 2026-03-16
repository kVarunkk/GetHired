"use client";

import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { useState } from "react";
import toast from "react-hot-toast";
import { createResumeAction } from "@/app/actions/create-resume";
import { IResume, TAICredits } from "@/utils/types";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import InfoTooltip from "./InfoTooltip";
import Link from "next/link";

export default function CreateResumeDialog({
  existingResumes,
}: {
  existingResumes: IResume[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const router = useRouter();

  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const creditsState = data && data.profile ? data.profile.ai_credits : 0;

  const handleStartProcessing = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const result = await createResumeAction(formData);

      if (result.success && result.resumeId) {
        toast.success("Resume added succesfully!");
        setIsOpen(false);
        setSelectedFile(null);
        router.refresh();
        router.push(`/resume/${result.resumeId}`);
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
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4" />
          Add Resume
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[440px] ">
        <DialogHeader>
          <DialogTitle>
            Add New Resume{" "}
            <InfoTooltip
              content={
                <p>
                  This feature uses {TAICredits.AI_SEARCH_ASK_AI_RESUME} AI
                  Credits. {creditsState} AI Credits available.{" "}
                  <Link href={"/dashboard"} className="text-blue-500">
                    Recharge Credits
                  </Link>
                </p>
              }
            />
          </DialogTitle>
          <DialogDescription>
            Upload a PDF version of your resume. Our AI will index it for
            further analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isUploading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4 animate-in fade-in duration-300">
              <Loader2 className="w-10 h-10 animate-spin " />

              <p className="text-sm text-muted-foreground">Processing Upload</p>
            </div>
          ) : (
            <ResumeSourceSelector
              existingResumes={existingResumes}
              selectedId={null}
              onSelectExisting={() => {}}
              file={selectedFile}
              onFileChange={(file) => setSelectedFile(file)}
              view="upload"
            />
          )}
          <Button
            onClick={() => {
              handleStartProcessing();
            }}
            disabled={!selectedFile || isUploading}
            className="w-full"
          >
            {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
            Upload Resume
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
