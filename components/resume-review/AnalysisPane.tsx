"use client";

import { cn } from "@/utils/utils";
import { ChevronDown, ChevronUp, Loader2, Target } from "lucide-react";
import { Dispatch, SetStateAction, useState } from "react";
import { TResumeReviewServer } from "@/utils/types/review.types";
import ReviewSuggestions from "./ReviewSuggestions";

export default function AnalysisPane({
  isParsed,
  isResumeLinked,
  isParsingFailed,
  currentReview,
  isAnalyzing,
  setActiveHighlightId,
  activeHighlightId,
  onRerun,
  readOnly = false,
}: {
  isParsed: boolean;
  isResumeLinked: boolean;
  isParsingFailed: boolean;
  currentReview: TResumeReviewServer;
  isAnalyzing: boolean;
  setActiveHighlightId: Dispatch<SetStateAction<string | null>>;
  activeHighlightId: string | null;
  onRerun?: () => void;
  /** The landing page's sample review, which has nothing to apply to. */
  readOnly?: boolean;
}) {
  const [isOverallOpen, setIsOverallOpen] = useState(true);

  return (
    <div className="h-[400px] sm:h-full sm:flex-1 overflow-y-scroll p-6 space-y-8 ">
      {/* Polling State */}
      {!isParsed && isResumeLinked && !isParsingFailed && (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 animate-in fade-in duration-500">
          <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in duration-300">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="font-medium">Indexing your Resume</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This might take a moment. You will be notified via email once the
              indexing is complete.
            </p>
          </div>
        </div>
      )}

      {/* Missing Resume State */}
      {!isResumeLinked && (
        <div className="space-y-2 text-center p-4">
          <h3 className="font-medium">Missing Resume Asset</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Select a resume from your profile library to initiate the tailoring
            process for this role.
          </p>
        </div>
      )}

      {/* Empty Analysis State */}
      {isParsed && !currentReview.ai_response && !isAnalyzing && (
        <div className="space-y-2 text-center p-4">
          <p className="font-medium">Awaiting Analysis</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Paste a Job Description on the right to begin.
          </p>
        </div>
      )}

      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in duration-300">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground max-w-[240px] leading-relaxed">
            Analyzing your Resume
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed text-center">
            This might take a moment. You will be notified via email once the
            analysis is complete.
          </p>
        </div>
      )}

      {currentReview?.ai_response?.overall_feedback && (
        <div className="rounded-xl border border-brand/30 bg-brandSoft overflow-hidden transition-all duration-300">
          <button
            onClick={() => setIsOverallOpen(!isOverallOpen)}
            className="w-full flex items-center justify-between p-4 text-start group hover:bg-brandSoft/10 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-brand text-brand-foreground">
                <Target size={14} />
              </div>
              <span className="text-xs font-medium text-brandSoft-foreground">
                Overall Strategy
              </span>
            </div>
            <div className="text-brand/60">
              {isOverallOpen ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </div>
          </button>

          <div
            className={cn(
              "px-4 transition-all duration-300 ease-in-out overflow-hidden",
              isOverallOpen
                ? "max-h-[800px] pb-5 opacity-100"
                : "max-h-0 opacity-0",
            )}
          >
            <div className="relative ">
              <p className="text-sm leading-6">
                {currentReview?.ai_response?.overall_feedback}
              </p>
            </div>
          </div>
        </div>
      )}

      {currentReview?.ai_response && !isAnalyzing && (
        <ReviewSuggestions
          review={currentReview}
          activeHighlightId={activeHighlightId}
          setActiveHighlightId={setActiveHighlightId}
          onRerun={onRerun}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
