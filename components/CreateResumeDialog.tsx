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
import { IResume } from "@/utils/types";
import { useRouter } from "next/navigation";

export default function CreateResumeDialog({
  existingResumes,
}: {
  existingResumes: IResume[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const router = useRouter();

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
    } catch {
      toast.error("An unexpected error occurred.");
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
          <DialogTitle>Add New Resume</DialogTitle>
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
