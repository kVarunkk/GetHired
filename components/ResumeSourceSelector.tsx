"use client";

import { reportClientError } from "@/lib/posthog/report-client-error";
import React, { useEffect, useState } from "react";
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
  const [fetchedName, setFetchedName] = useState<string | null>(null);

  const selectedResume = selectedId
    ? existingResumes.find((r) => r.id === selectedId)
    : undefined;
  const knownPath = selectedResume?.resume_path ?? null;
  const selectedName = file
    ? file.name
    : selectedResume?.name || fetchedName || null;
  const hasSelection = Boolean(file || selectedId);

  useEffect(() => {
    // Set when the selection changes again, so a slow signed URL for an
    // earlier pick can't replace the current one.
    let ignore = false;
    setPreviewUrl(null);
    setFetchedName(null);

    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => {
        ignore = true;
        URL.revokeObjectURL(url);
      };
    }
    if (!selectedId) return;

    (async () => {
      try {
        const supabase = createClient();
        let path = knownPath;
        if (!path) {
          const { data: resumeData, error: fetchError } = await supabase
            .from("resumes")
            .select("resume_path, name")
            .eq("id", selectedId)
            .single();
          if (fetchError || !resumeData?.resume_path)
            throw new Error("Resume not found");
          path = resumeData.resume_path;
          if (!ignore) setFetchedName(resumeData.name || null);
        }

        const { data, error: signedError } = await supabase.storage
          .from("resumes")
          .createSignedUrl(path, 3600);
        if (signedError) throw signedError;
        if (!ignore) setPreviewUrl(data?.signedUrl || null);
      } catch (error) {
        reportClientError("[resume preview] couldn't load the preview", error);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [file, selectedId, knownPath]);

  // min-w-0 so a grid or flex-row parent can't size it to its longest
  // (truncated) resume name.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {view === "upload" ? (
        <UploadResumeParent
          file={file}
          onFileChange={onFileChange}
          onSelectExisting={onSelectExisting}
        />
      ) : view === "select" ? (
        <SelectResumeParent
          existingResumes={existingResumes}
          onFileChange={onFileChange}
          onSelectExisting={onSelectExisting}
          selectedId={selectedId}
        />
      ) : (
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-2 ">
            {/* The verbs are dropped on the narrowest phones so both tabs fit. */}
            <TabsTrigger value="upload" className="min-w-0">
              <span className="max-[400px]:hidden">Upload&nbsp;</span>New
            </TabsTrigger>
            <TabsTrigger value="existing" className="min-w-0">
              <span className="max-[400px]:hidden">Select&nbsp;</span>Existing (
              {existingResumes.length})
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
            <SelectResumeParent
              existingResumes={existingResumes}
              onFileChange={onFileChange}
              onSelectExisting={onSelectExisting}
              selectedId={selectedId}
            />
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
      {/* Switching resumes only swaps the card's contents, so the fade plays
          when it first appears and not on every pick. */}
      {hasSelection && (
        <div className="animate-in fade-in duration-200">
          <ResumePreview previewUrl={previewUrl} name={selectedName} />
        </div>
      )}
    </div>
  );
}
