"use client";

import { cn } from "@/lib/utils";
import { Eye, File, FileText, Loader2, RefreshCcw } from "lucide-react";
import ResumeSourceSelector from "../ResumeSourceSelector";
import DigitalTwinMirror from "./DigitalTwinMirror";
import { IResume } from "@/lib/types";
import { useEffect, useState } from "react";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { Button } from "../ui/button";

export default function ResumeSection({
  isParsed,
  isJdPaneOpen,
  existingResumes,
  linkedResume,
  activeHighlightId,
  handleLinkResume,
  isResumeLinked,
  userId,
  isParsingFailed,
  refreshResumeStatus,
}: {
  isParsed: boolean;
  isJdPaneOpen: boolean;
  existingResumes: IResume[];
  linkedResume?: IResume;
  activeHighlightId: string | null;
  handleLinkResume: (resumeId: string | null) => Promise<void>;
  isResumeLinked: boolean;
  userId: string;
  isParsingFailed: boolean;
  refreshResumeStatus: () => Promise<void>;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [viewMode, setViewMode] = useState<"mirror" | "original">("mirror");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const handleStartProcessing = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    const toastId = toast.loading("Adding new Resume...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("userId", userId);

      // Trigger the background upload and parse action
      const result = await uploadResumeAction(formData);

      if (result.success && result.resumeId) {
        toast.success("Resume uploaded. Initializing sync...", { id: toastId });
        // Link the newly created resume to this specific review record
        await handleLinkResume(result.resumeId);
        setSelectedFile(null);
        // setPreviewUrl(null);
      } else {
        toast.error(result.error || "Upload failed", { id: toastId });
      }
    } catch {
      toast.error("An unexpected error occurred during upload.", {
        id: toastId,
      });
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Fetch a signed URL for the original PDF when the view mode is set to "original"
   * or when a new resume is linked.
   */
  useEffect(() => {
    const getSignedUrl = async () => {
      if (!isResumeLinked || !linkedResume?.resume_path) return;

      setLoadingUrl(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase.storage
          .from("resumes")
          .createSignedUrl(linkedResume.resume_path, 3600); // 1 hour validity

        if (error) throw error;
        setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error("Error generating signed URL:", err);
        // toast.error("Could not load original PDF.");
      } finally {
        setLoadingUrl(false);
      }
    };

    if (isResumeLinked) {
      getSignedUrl();
    }
  }, [isResumeLinked, linkedResume?.resume_path]);

  const handleRetryParsing = async () => {
    if (!linkedResume?.id) return;

    setIsRetrying(true);
    const toastId = toast.loading("Restarting document synchronization...");
    const supabase = createClient();
    try {
      // Reset the flag in DB so the UI and parent polling knows to try again
      const { error: resetError } = await supabase
        .from("resumes")
        .update({ parsing_failed: false })
        .eq("id", linkedResume.id);

      if (resetError) throw resetError;

      // Trigger the parse API route
      const res = await fetch("/api/parse-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, resumeId: linkedResume.id }),
      });

      if (!res.ok) throw new Error("API failed to initialize synchronization.");

      // Refresh parent state to flip parsing_failed to false and restart the polling useEffect
      await refreshResumeStatus();

      toast.success("Parsing restarted successfully.", { id: toastId });
    } catch (err) {
      console.error("Retry failed:", err);
      toast.error(
        "Failed to restart parsing. Please try manually re-uploading.",
        { id: toastId }
      );
      await supabase
        .from("resumes")
        .update({
          parsing_failed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkedResume.id);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      className={cn(
        "border-b border-t sm:border-t-0 overflow-hidden flex flex-col",
        isJdPaneOpen ? "flex-[0.6]" : "flex-1"
      )}
    >
      <div className="p-4  flex flex-wrap gap-4 items-center justify-between border-b bg-background/50 backdrop-blur-md">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-lg font-bold">Resume</div>

          {isResumeLinked && isParsed && (
            <div className="flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setViewMode("mirror")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider rounded-md transition-all",
                  viewMode === "mirror"
                    ? "bg-white dark:bg-zinc-800 text-primary shadow-sm"
                    : "text-zinc-500 hover:text-muted-foreground"
                )}
              >
                <Eye size={12} />
                Mirror
              </button>
              <button
                onClick={() => setViewMode("original")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs  font-semibold uppercase tracking-wider rounded-md transition-all",
                  viewMode === "original"
                    ? "bg-white dark:bg-zinc-800 text-primary shadow-sm"
                    : "text-zinc-500 hover:text-muted-foreground"
                )}
              >
                <FileText size={12} />
                Original
              </button>
            </div>
          )}
        </div>

        {linkedResume && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <File className="w-4 h-4 " />
            {linkedResume?.name}
          </div>
        )}
      </div>

      <div className="flex-1 relative p-4 sm:p-10 overflow-y-auto  scrollbar-hide">
        {isParsingFailed ? (
          <div className="flex flex-col gap-4 justify-center items-center">
            <h2 className="text-muted-foreground font-semibold text-center">
              Unfortunately, there was an error parsing your resume. Please try
              again.
            </h2>
            <Button onClick={handleRetryParsing} disabled={isRetrying}>
              {isRetrying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
              Retry Parsing
            </Button>
          </div>
        ) : !isResumeLinked ? (
          <div className="max-w-md mx-auto py-10">
            {isUploading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in duration-300">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm font-bold text-muted-foreground ">
                  Processing Upload
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <ResumeSourceSelector
                  existingResumes={existingResumes}
                  selectedId={selectedResumeId}
                  onSelectExisting={setSelectedResumeId}
                  file={selectedFile}
                  onFileChange={setSelectedFile}
                />
                <Button
                  onClick={() => {
                    if (selectedResumeId) {
                      handleLinkResume(selectedResumeId);
                    } else {
                      handleStartProcessing();
                    }
                  }}
                  disabled={!(selectedFile || selectedResumeId) || isUploading}
                >
                  Add Resume
                </Button>
              </div>
            )}
          </div>
        ) : isParsed ? (
          <div className="h-full">
            {viewMode === "mirror" ? (
              <DigitalTwinMirror
                content={linkedResume?.content}
                activeHighlightId={activeHighlightId}
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center">
                {loadingUrl ? (
                  <div className="flex flex-col items-center justify-center h-64 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin " />
                    <p className="text-muted-foreground font-bold">
                      Requesting Document...
                    </p>
                  </div>
                ) : signedUrl ? (
                  /* NON-IFRAME PDF EMBEDDING: Using <object> tag */
                  <div className="w-full h-full max-w-4xl bg-white shadow-2xl rounded-sm overflow-hidden border border-border animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <object
                      data={`${signedUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                      type="application/pdf"
                      className="w-full h-[800px] lg:h-full"
                    >
                      <div className="p-10 text-center space-y-4">
                        <p className="text-sm text-muted-foreground">
                          This browser does not support inline PDFs.
                        </p>
                        <a
                          href={signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand font-bold hover:underline"
                        >
                          Download to view
                        </a>
                      </div>
                    </object>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground ">
                    Failed to load preview.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground  animate-pulse">
              Awaiting document synchronization...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
