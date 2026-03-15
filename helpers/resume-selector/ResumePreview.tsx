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
      <div className="flex items-center gap-3">
        <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg shadow-sm">
          <ResumePreviewDialog displayUrl={previewUrl} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 tracking-wider">
            Selected Resume Preview
          </span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 ">
            {file?.name || activeResumeName}
          </span>
        </div>
      </div>
    </div>
  );
};
