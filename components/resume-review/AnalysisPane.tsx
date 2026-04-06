"use client";

import { cn, copyToClipboard } from "@/utils/utils";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Info,
  Loader2,
  Target,
} from "lucide-react";
import { Button } from "../ui/button";
import { Dispatch, SetStateAction, useState } from "react";
import { TResumeReviewServer } from "@/utils/types/review.types";

export default function AnalysisPane({
  isParsed,
  isResumeLinked,
  isParsingFailed,
  currentReview,
  isAnalyzing,
  setActiveHighlightId,
  activeHighlightId,
}: {
  isParsed: boolean;
  isResumeLinked: boolean;
  isParsingFailed: boolean;
  currentReview: TResumeReviewServer;
  isAnalyzing: boolean;
  setActiveHighlightId: Dispatch<SetStateAction<string | null>>;
  activeHighlightId: string | null;
}) {
  const [isOverallOpen, setIsOverallOpen] = useState(true);

  return (
    <div className="h-[400px] sm:h-full sm:flex-1 overflow-y-scroll p-6 space-y-8 ">
      {/* Polling State */}
      {!isParsed && isResumeLinked && !isParsingFailed && (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 animate-in fade-in duration-500">
          <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in duration-300">
            <Loader2 className="w-8 h-8 animate-spin" />

            <p className="text-xs font-bold text-muted-foreground max-w-[240px] leading-relaxed">
              We are currently indexing your resume line-by-line for
              high-precision feedback.
            </p>
          </div>
        </div>
      )}

      {/* Missing Resume State */}
      {!isResumeLinked && (
        <div className="space-y-2 text-center p-4">
          <h3 className="font-bold text-zinc-800 dark:text-zinc-200">
            Missing Resume Asset
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Select a resume from your profile library to initiate the tailoring
            process for this role.
          </p>
        </div>
      )}

      {/* Empty Analysis State */}
      {isParsed && !currentReview.ai_response && !isAnalyzing && (
        <div className="space-y-2 text-center p-4">
          <p className="font-bold text-zinc-800 dark:text-zinc-200">
            Awaiting Analysis
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Paste a Job Description on the right to begin.
          </p>
        </div>
      )}

      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in duration-300">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-xs font-bold text-muted-foreground max-w-[240px] leading-relaxed">
            Analyzing your Resume
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This might take up to a minute. You will be notified via email once
            the analysis is complete.
          </p>
        </div>
      )}

      {currentReview.ai_response?.overall_feedback && (
        <div className="rounded-2xl border border-brand/20 bg-brandSoft overflow-hidden transition-all duration-300 shadow-sm">
          <button
            onClick={() => setIsOverallOpen(!isOverallOpen)}
            className="w-full flex items-center justify-between p-4 text-start group hover:bg-brandSoft/10 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-brand text-brand-foreground shadow-sm">
                <Target size={14} />
              </div>
              <span className="text-xs font-black uppercase tracking-widest text-brand dark:text-primary">
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
              <p className="text-xs leading-relaxed text-brand-soft-foreground font-medium ">
                {currentReview.ai_response.overall_feedback}
              </p>
            </div>
          </div>
        </div>
      )}

      {currentReview.ai_response?.bullet_points?.map((bp) => (
        <button
          key={bp.bullet_id}
          onMouseEnter={() => {
            if (
              typeof window !== "undefined" &&
              window.matchMedia("(hover: hover)").matches
            ) {
              setActiveHighlightId(bp.bullet_id);
            }
          }}
          onMouseLeave={() => {
            if (
              typeof window !== "undefined" &&
              window.matchMedia("(hover: hover)").matches
            ) {
              setActiveHighlightId(null);
            }
          }}
          className={cn(
            "w-full text-start group space-y-4 p-5 rounded-2xl border transition-all ",
            activeHighlightId === bp.bullet_id
              ? "border-indigo-500 bg-white dark:bg-zinc-900 shadow-xl"
              : "bg-white/50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800",
          )}
          onClick={() => {
            // Only trigger card-wide click on devices that can hover (laptops)
            if (
              typeof window !== "undefined" &&
              window.matchMedia("(hover: hover)").matches
            ) {
              copyToClipboard(bp.suggested, "Suggestion copied!");
            }
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-brand">
              {bp.section}
            </span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">
              {bp.priority}
            </span>
          </div>
          <div className="space-y-2">
            <p className="text-xs line-through opacity-40 ">{bp.original}</p>
            <p className=" text-sm font-semibold leading-relaxed">
              {bp.suggested}
              <Copy className="h-4 w-4 hidden group-hover:inline ml-2 transition-all" />
            </p>
          </div>
          {/* TOUCH SCREEN ACTION BUTTONS 
                   Hiding logic: 
                   - 'hidden' by default.
                   - '[@media(hover:none)]:flex' only shows these on touchscreens (mobile/tablet).
                */}
          <div className="hidden [@media(hover:none)]:flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation(); // Prevent duplicate trigger from card click
                copyToClipboard(bp.suggested, "Suggestion copied!");
              }}
              className="flex-1 gap-2 text-[10px] font-bold uppercase tracking-tighter border-zinc-200 dark:border-zinc-800 rounded-lg h-9 active:bg-brandSoft"
            >
              <Copy size={12} />
              Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                setActiveHighlightId(bp.bullet_id);
              }}
              className={cn(
                "flex-1 gap-2 text-[10px] font-bold uppercase tracking-tighter border-zinc-200 dark:border-zinc-800 rounded-lg h-9 transition-all",
                activeHighlightId === bp.bullet_id
                  ? "bg-brand border-brand text-white"
                  : "active:bg-brandSoft",
              )}
            >
              <Eye size={12} />
              {activeHighlightId === bp.bullet_id ? "Focused" : "Focus"}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground border-t border-zinc-100 dark:border-zinc-800 pt-3 leading-relaxed flex items-center gap-2">
            <Info className="w-3 h-3  text-muted-foreground shrink-0" />
            {bp.reason}
          </p>
        </button>
      ))}
    </div>
  );
}
