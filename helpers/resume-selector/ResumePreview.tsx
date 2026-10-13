import ResumePreviewDialog from "@/components/ResumePreviewDialog";

export const ResumePreview = ({
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
      <div className="flex min-w-0 items-center gap-3">
        <div className="shrink-0 bg-background p-2 rounded-lg border">
          <ResumePreviewDialog displayUrl={previewUrl} />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider">
            Selected Resume Preview
          </span>
          <span className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {file?.name || activeResumeName}
          </span>
        </div>
      </div>
    </div>
  );
};
