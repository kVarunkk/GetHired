"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { UploadResumeParent } from "@/helpers/resume-selector/UploadResumeParent";
import { SelectResumeParent } from "@/helpers/resume-selector/SelectResumeParent";
import { ResumePreview } from "@/helpers/resume-selector/ResumePreview";
import { TResumeReviewResume } from "@/utils/types/review.types";

interface ResumeSourceSelectorProps {
  existingResumes: (TResumeReviewResume & {
    resume_path?: string | null;
  })[];
  selectedId: string | null;
  onSelectExisting: (id: string | null) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  view?: "upload" | "select" | "both";
  showManageResumes?: boolean;
}

export default function ResumeSourceSelector({
  existingResumes,
  selectedId,
  onSelectExisting,
  file,
  onFileChange,
  view = "both",
  showManageResumes = true,
}: ResumeSourceSelectorProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeResumeName, setActiveResumeName] = useState<string | null>(null);
  const [isLoadingSignedUrl, setIsLoadingSignedUrl] = useState(false);

  useEffect(() => {
    const handlePreviewUrl = async () => {
      if (file) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setActiveResumeName(null);
        setPreviewUrl(URL.createObjectURL(file));
      } else if (selectedId) {
        setIsLoadingSignedUrl(true);
        setPreviewUrl(null);
        setActiveResumeName(null);

        try {
          const supabase = createClient();

          const { data: resumeData, error: fetchError } = await supabase
            .from("resumes")
            .select("resume_path, name")
            .eq("id", selectedId)
            .single();

          if (fetchError || !resumeData || !resumeData.resume_path)
            throw new Error("Resume not found");

          const { data, error: signedError } = await supabase.storage
            .from("resumes")
            .createSignedUrl(resumeData.resume_path, 3600);

          if (signedError) throw signedError;
          setActiveResumeName(resumeData?.name || null);
          setPreviewUrl(data?.signedUrl || null);
        } catch {
        } finally {
          setIsLoadingSignedUrl(false);
        }
      } else {
        setPreviewUrl(null);
      }
    };
    handlePreviewUrl();
  }, [file, selectedId]);

  return (
    <div className="flex flex-col gap-4">
      {view === "upload" ? (
        <UploadResumeParent
          file={file}
          onFileChange={onFileChange}
          onSelectExisting={onSelectExisting}
        />
      ) : view === "select" ? (
        <div className="max-h-[300px] overflow-y-auto">
          <SelectResumeParent
            existingResumes={existingResumes}
            onFileChange={onFileChange}
            onSelectExisting={onSelectExisting}
            selectedId={selectedId}
          />
        </div>
      ) : (
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-2 ">
            <TabsTrigger value="upload">Upload New</TabsTrigger>
            <TabsTrigger value="existing">
              Select Existing ({existingResumes.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <UploadResumeParent
              file={file}
              onFileChange={onFileChange}
              onSelectExisting={onSelectExisting}
            />
          </TabsContent>
          <TabsContent value="existing">
            <div className="max-h-[300px] overflow-y-auto">
              <SelectResumeParent
                existingResumes={existingResumes}
                onFileChange={onFileChange}
                onSelectExisting={onSelectExisting}
                selectedId={selectedId}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}
      {showManageResumes && (
        <div>
          <Link
            className="text-xs text-muted-foreground underline "
            href="/resume"
          >
            Manage Resumes
          </Link>
        </div>
      )}
      {isLoadingSignedUrl ? (
        <div className="p-4 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : previewUrl ? (
        <div
          ref={(el) => {
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }}
          className="animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <ResumePreview
            previewUrl={previewUrl}
            file={file}
            activeResumeName={activeResumeName}
          />
        </div>
      ) : (
        ""
      )}
    </div>
  );
}
