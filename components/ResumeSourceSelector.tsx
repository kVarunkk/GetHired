"use client";

import React, { useEffect, useState } from "react";
import {
  UploadCloud,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IResume, TLimits } from "@/lib/types";
import Link from "next/link";
import { Button } from "./ui/button";
import ResumePreviewDialog from "./ResumePreviewDialog";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { Badge } from "./ui/badge";

interface ResumeSourceSelectorProps {
  existingResumes: IResume[];
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
        setPreviewUrl(null); // Instant cleanup
        setActiveResumeName(null);

        try {
          const supabase = createClient();

          const { data: resumeData, error: fetchError } = await supabase
            .from("resumes")
            .select("resume_path, name")
            .eq("id", selectedId)
            .single();

          if (fetchError || !resumeData) throw new Error("Resume not found");

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
          existingResumes={existingResumes}
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
            <TabsTrigger value="upload">Upload New</TabsTrigger>
            <TabsTrigger value="existing">
              Select Existing ({existingResumes.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="">
            <UploadResumeParent
              file={file}
              onFileChange={onFileChange}
              existingResumes={existingResumes}
              onSelectExisting={onSelectExisting}
            />
          </TabsContent>
          <TabsContent value="existing" className="">
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
        <div className="">
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
        <ResumePreview
          previewUrl={previewUrl}
          file={file}
          activeResumeName={activeResumeName}
        />
      ) : (
        ""
      )}
    </div>
  );
}

const SelectResumeParent = ({
  existingResumes,
  onFileChange,
  onSelectExisting,
  selectedId,
}: {
  existingResumes: IResume[];
  onFileChange: (file: File | null) => void;
  onSelectExisting: (id: string | null) => void;
  selectedId: string | null;
}) => {
  return (
    <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-2 pr-2 scrollbar-thin scrollbar-thumb-zinc-800 pb-2">
      {existingResumes?.length > 0 ? (
        existingResumes.map((resume) => (
          <button
            title={resume.name}
            key={resume.id}
            type="button"
            onClick={() => {
              onFileChange(null);
              onSelectExisting(resume.id);
            }}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left",
              selectedId === resume.id
                ? "border-brand bg-brandSoft "
                : "border-border group text-muted-foreground hover:border-zinc-400 hover:text-primary",
            )}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileCheck
                size={18}
                className={
                  selectedId === resume.id
                    ? "text-brand"
                    : "text-muted-foreground group-hover:text-primary"
                }
              />
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <p className="text-sm font-bold truncate w-[100px] sm:w-[150px]">
                    {resume.name}
                  </p>
                  {resume.is_primary && <Badge>PRIMARY</Badge>}
                </div>
                <p className="text-[10px] opacity-50">
                  {new Date(resume.created_at || "").toLocaleDateString()}
                </p>
              </div>
            </div>
            {selectedId === resume.id && (
              <CheckCircle2 size={16} className="text-brand" />
            )}
          </button>
        ))
      ) : (
        <div className="p-6 text-center text-muted-foreground">
          No existing resumes. Upload new.
        </div>
      )}
    </div>
  );
};

const UploadResumeParent = ({
  existingResumes,
  file,
  onFileChange,
  onSelectExisting,
}: {
  existingResumes: IResume[];
  file: File | null;
  onFileChange: (file: File | null) => void;
  onSelectExisting: (id: string | null) => void;
}) => {
  const handleInternalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // 1. PDF Type Validation (Mobile fix)
    const isPdf =
      selectedFile.type === "application/pdf" ||
      selectedFile.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Only PDF files are allowed.");
      e.target.value = ""; // Clear the input
      return;
    }

    // 2. Size Validation (5MB = 5 * 1024 * 1024 bytes)
    const MAX_SIZE_MB = 5;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE_BYTES) {
      toast.error(`File is too large. Maximum limit is ${MAX_SIZE_MB}MB.`);
      e.target.value = ""; // Clear the input
      return;
    }
    onSelectExisting(null);
    onFileChange(selectedFile);
  };

  return (
    <div>
      {existingResumes.length >= TLimits.RESUME ? (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50 rounded-2xl p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="text-amber-600 w-6 h-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Library Full
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              You have reached the {TLimits.RESUME} resume limit. Please remove
              an existing asset from your dashboard to upload a new one.
            </p>
          </div>
          <Button type="button" variant={"outline"} asChild>
            <Link
              href={"/resume"}
              className="w-full text-xs font-bold uppercase tracking-widest border-amber-200 dark:border-amber-800"
            >
              Manage Resumes
            </Link>
          </Button>
        </div>
      ) : (
        <div>
          {file ? (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                    <FileText className="w-5 h-5 text-brand" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold truncate max-w-[180px]">
                      {file?.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase font-medium">
                      {(file?.size / 1024 / 1024).toFixed(2)} MB • Ready
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onFileChange(null)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "relative border-2 border-dashed rounded-xl p-8 transition-all flex flex-col items-center justify-center gap-2",
                "border-zinc-800 hover:border-zinc-700",
              )}
            >
              <input
                type="file"
                accept=".pdf"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  handleInternalFileChange(e);
                }}
              />
              <UploadCloud
                className={cn(
                  "w-8 h-8",
                  file ? "text-brand" : "text-muted-foreground",
                )}
              />
              <p className="text-sm font-medium text-muted-foreground">
                {"Click to upload PDF"}
              </p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-tighter">
                PDF only • Max 5MB
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ResumePreview = ({
  previewUrl,
  file,
  activeResumeName,
}: {
  previewUrl: string;
  file: File | null;
  activeResumeName: string | null;
}) => {
  return (
    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-between transition-all animate-in fade-in zoom-in duration-300">
      <div className="flex items-center gap-3">
        <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg shadow-sm">
          <ResumePreviewDialog displayUrl={previewUrl} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider">
            Selected Resume Preview
          </span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 truncate max-w-[150px]">
            {file?.name || activeResumeName}
          </span>
        </div>
      </div>
    </div>
  );
};
