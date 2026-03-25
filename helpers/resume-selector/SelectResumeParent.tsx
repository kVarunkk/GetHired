import { Badge } from "@/components/ui/badge";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { cn } from "@/utils/utils";
import { CheckCircle2, FileCheck } from "lucide-react";

export const SelectResumeParent = ({
  existingResumes,
  onFileChange,
  onSelectExisting,
  selectedId,
}: {
  existingResumes: (TResumeReviewResume & {
    resume_path?: string | null;
  })[];
  onFileChange: (file: File | null) => void;
  onSelectExisting: (id: string | null) => void;
  selectedId: string | null;
}) => {
  return (
    <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-2 pr-2 scrollbar-thin scrollbar-thumb-zinc-800 pb-2">
      {existingResumes?.length > 0 ? (
        existingResumes.map((resume) => (
          <button
            title={resume.name || ""}
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
