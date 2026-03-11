import { Button } from "@/components/ui/button";
import { IResume, TLimits } from "@/utils/types";
import { cn } from "@/utils/utils";
import { AlertTriangle, FileText, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";

export const UploadResumeParent = ({
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
