import { Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/utils";
import { interviewBadge, type InterviewSummary } from "@/helpers/interview/screening/summary-view";

const TONE_CLASSES = {
  neutral: "",
  active: "border-brand/30 text-brand",
  done: "border-success/30 bg-success/10 text-success",
  muted: "text-muted-foreground",
  warning: "border-warning/40 bg-warning/10",
} as const;

/** One application's AI interview, on the applicants list and board cards (SIT-062). */
export default function InterviewStatusBadge({
  summary,
  className,
}: {
  summary: InterviewSummary;
  className?: string;
}) {
  const badge = interviewBadge(summary);
  return (
    <Badge
      variant="outline"
      title="AI interview"
      className={cn("gap-1 whitespace-nowrap font-normal", TONE_CLASSES[badge.tone], className)}
    >
      <Mic className="h-3 w-3" aria-hidden />
      {badge.label}
    </Badge>
  );
}
