"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { cn, copyToClipboard } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Info,
  Loader2,
  Target,
} from "lucide-react";
import BackButton from "./BackButton";
import ResumeSection from "./resume-review/ResumeSection";
import JdSection from "./resume-review/JdSection";
import { IResume, IResumeReview, TPaymentStatus } from "@/lib/types";
import { Button } from "./ui/button";

interface ReviewWorkspaceProps {
  userId: string;
  review: IResumeReview;
  initialJd: string;
  existingResumes: IResume[];
}

export default function ResumeReviewClient({
  userId,
  review,
  initialJd,
  existingResumes,
}: ReviewWorkspaceProps) {
  const supabase = createClient();

  const [currentReview, setCurrentReview] = useState(review);
  const [jdText, setJdText] = useState(initialJd);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null,
  );
  const [isJdPaneOpen, setIsJdPaneOpen] = useState(true);
  const [isOverallOpen, setIsOverallOpen] = useState(true);

  const hoveredBulletRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (activeHighlightId) {
      const element = document.getElementById(`bullet-${activeHighlightId}`);
      if (element && element !== hoveredBulletRef.current) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        hoveredBulletRef.current = element;
      }
    } else {
      hoveredBulletRef.current = null;
    }
  }, [activeHighlightId]);

  const linkedResume = currentReview?.resumes;
  const isResumeLinked = !!currentReview?.resume_id;
  const isParsed = !!linkedResume?.content;
  const isParsingFailed = !!linkedResume?.parsing_failed;

  /**
   * 1. POLLING LOGIC
   * If a resume is linked but not yet parsed (content is null),
   * we poll the DB until the 'content' field is populated by the background worker.
   */
  useEffect(() => {
    if (isResumeLinked && !isParsed && !isParsingFailed) {
      const interval = setInterval(async () => {
        try {
          const { data, error } = await supabase
            .from("resumes")
            .select("id, name, content, resume_path, parsing_failed")
            .eq("id", currentReview.resume_id)
            .single();

          if (!error && (data?.content || data?.parsing_failed)) {
            setCurrentReview((prev) => ({
              ...prev,
              resumes: data,
            }));
            clearInterval(interval);
            toast.success("Resume indexing complete.");
          }
        } catch (e) {
          console.error("Polling check failed", e);
        }
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [
    currentReview.resume_id,
    isParsed,
    isParsingFailed,
    supabase,
    isResumeLinked,
  ]);

  /**
   * 2. LINK RESUME ACTION
   * Handles the case where a user selects a resume from the library
   * if the review was initialized without one.
   */
  const handleLinkResume = useCallback(
    async (resumeId: string | null) => {
      if (!resumeId) return;

      try {
        const { error } = await supabase
          .from("resume_reviews")
          .update({ resume_id: resumeId })
          .eq("id", currentReview.id);

        if (error) {
          toast.error("Failed to link resume asset.");
        } else {
          // Update local state to trigger the polling effect
          setCurrentReview((prev) => ({ ...prev, resume_id: resumeId }));
          toast.success("Resume linked successfully.");
        }
      } catch {
        toast.error("Link action failed.");
      }
    },
    [supabase, setCurrentReview, currentReview.id],
  );

  /**
   * 3. AI ANALYSIS TRIGGER
   * Calls the backend to perform the semantic comparison between the
   * digital twin and the provided job description.
   */
  const runAnalysis = async () => {
    if (!jdText.trim())
      return toast.error("Please paste a job description first.");

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/resume-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: currentReview.id,
          targetJd: jdText,
          userId: userId,
        }),
      });

      if (!res.ok) throw new Error("API error");

      const data = await res.json();
      if (data.success) {
        setCurrentReview((prev) => ({
          ...prev,
          ai_response: data.analysis,
          score: data.analysis.score,
          status: "completed" as TPaymentStatus.COMPLETE,
        }));
        setIsOverallOpen(true);
        toast.success("Analysis complete.");
      } else {
        throw new Error("AI analysis failed");
        // toast.error(data.error || "AI analysis failed.");
      }
    } catch {
      toast.error("Some error occured during analysis. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const refreshResumeStatus = useCallback(async () => {
    if (!currentReview.resume_id) return;

    const { data, error } = await supabase
      .from("resumes")
      .select("id, name, content, resume_path, parsing_failed")
      .eq("id", currentReview.resume_id)
      .single();

    if (!error && data) {
      setCurrentReview((prev) => ({
        ...prev,
        resumes: data, // This updates parsing_failed to false, triggering the useEffect
      }));
    }
  }, [currentReview, setCurrentReview, supabase]);

  return (
    <div className="flex flex-col sm:flex-row sm:h-[calc(100vh)] sm:overflow-hidden bg-background">
      {/* LEFT PANE: ANALYSIS & SUGGESTIONS */}
      <aside className="sm:w-[40%] border-r flex flex-col ">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="flex flex-col ">
              <h2 className="text-lg font-bold">Analysis Pane</h2>
              <p className=" text-muted-foreground text-sm">{review.name}</p>
            </div>
          </div>
          {currentReview.score && (
            <div className="text-right">
              <div className="text-2xl font-black text-brand">
                {currentReview.score}
              </div>
              <div className=" text-muted-foreground font-bold  tracking-tighter">
                Match Score
              </div>
            </div>
          )}
        </div>

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
                Select a resume from your profile library to initiate the
                tailoring process for this role.
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
                <p className="text-xs line-through opacity-40 ">
                  {bp.original}
                </p>
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
      </aside>

      {/* RIGHT PANE: RESUME VIEW & JD INPUT */}
      <div className="flex-1 flex flex-col min-w-0 ">
        {/* TOP: RESUME DISPLAY / SELECTOR */}
        <ResumeSection
          isParsed={isParsed}
          isJdPaneOpen={isJdPaneOpen}
          existingResumes={existingResumes}
          linkedResume={linkedResume}
          activeHighlightId={activeHighlightId}
          handleLinkResume={handleLinkResume}
          isResumeLinked={isResumeLinked}
          userId={userId}
          isParsingFailed={isParsingFailed}
          refreshResumeStatus={refreshResumeStatus}
        />

        {/* BOTTOM: JD EDITOR */}
        <JdSection
          isJdPaneOpen={isJdPaneOpen}
          setIsJdPaneOpen={setIsJdPaneOpen}
          isParsed={isParsed}
          isAnalyzing={isAnalyzing}
          jdText={jdText}
          setJdText={setJdText}
          runAnalysis={runAnalysis}
        />
      </div>
    </div>
  );
}
