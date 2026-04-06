"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import BackButton from "./BackButton";
import ResumeSection from "./resume-review/ResumeSection";
import JdSection from "./resume-review/JdSection";
import {
  TResumeReviewResume,
  TResumeReviewServer,
} from "@/utils/types/review.types";
import AnalysisPane from "./resume-review/AnalysisPane";
import { useRouter } from "next/navigation";
import { markAnalysisAsFailedAction } from "@/app/actions/mark-review-analysis-failed";

interface ReviewWorkspaceProps {
  review: TResumeReviewServer;
  initialJd: string;
  existingResumes: TResumeReviewResume[];
}

export default function ResumeReviewClient({
  review,
  initialJd,
  existingResumes,
}: ReviewWorkspaceProps) {
  const supabase = createClient();

  const [currentReview, setCurrentReview] = useState(review);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null,
  );
  const [isJdPaneOpen, setIsJdPaneOpen] = useState(true);

  const router = useRouter();

  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeHighlightId) return;
    const element = document.getElementById(`bullet-${activeHighlightId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeHighlightId]);

  const linkedResume = currentReview?.resumes;
  const isResumeLinked = !!currentReview?.resume_id;
  const isParsed = !!linkedResume?.content;
  const isParsingFailed = !!linkedResume?.parsing_failed;
  const isAnalyzing = currentReview.status === "processing";

  useEffect(() => {
    if (
      currentReview.status !== "processing" ||
      currentReview.ai_response ||
      currentReview.analysis_failed
    ) {
      return;
    }

    let timerId: NodeJS.Timeout;

    const checkStatus = async () => {
      if (!isMounted.current) return;
      try {
        const { data, error } = await supabase
          .from("resume_reviews")
          .select("ai_response, score, status, analysis_failed")
          .eq("id", currentReview.id)
          .single();

        if (!error && data) {
          if (data.ai_response && data.analysis_failed === false) {
            toast.success("Analysis complete!");
            router.refresh();
            return;
          }

          if (data.analysis_failed === true) {
            toast.error("Analysis failed.");
            router.refresh();
            return;
          }
        }

        timerId = setTimeout(checkStatus, 3000);
      } catch {
        timerId = setTimeout(checkStatus, 5000);
      }
    };

    timerId = setTimeout(checkStatus, 1000);
    return () => clearTimeout(timerId);
  }, [
    currentReview.id,
    currentReview.status,
    currentReview.ai_response,
    currentReview.analysis_failed,
    supabase,
    router,
  ]);

  const runAnalysis = async (jd: string) => {
    setCurrentReview((prev) => ({
      ...prev,
      status: "processing",
      analysis_failed: false,
      ai_response: null,
      score: null,
    }));

    try {
      const res = await fetch("/api/resume-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: currentReview.id,
          targetJd: jd,
        }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw error;
      }

      // Refresh the server-side props to stay in sync
      router.refresh();
    } catch (err) {
      // Revert status on failure
      setCurrentReview((prev) => ({
        ...prev,
        status: "failed",
        analysis_failed: true,
      }));
      await markAnalysisAsFailedAction(review.id);
      toast.error("Something went wrong. Please try again.");
    }
  };

  useEffect(() => {
    if (!isResumeLinked || isParsed || isParsingFailed) return;

    let timerId: NodeJS.Timeout;

    const checkStatus = async () => {
      if (!isMounted.current) return;

      try {
        const { data, error } = await supabase
          .from("resumes")
          .select("id, name, content, resume_path, parsing_failed")
          .eq("id", currentReview.resume_id!)
          .single();

        if (!error && data && (data.content || data.parsing_failed)) {
          router.refresh();
          return;
        }

        timerId = setTimeout(checkStatus, 3000);
      } catch {
        timerId = setTimeout(checkStatus, 5000);
      }
    };

    timerId = setTimeout(checkStatus, 2000);
    return () => clearTimeout(timerId);
  }, [
    isResumeLinked,
    isParsed,
    isParsingFailed,
    currentReview.resume_id,
    supabase,
    router,
  ]);

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

        <AnalysisPane
          isParsed={isParsed}
          isResumeLinked={isResumeLinked}
          isParsingFailed={isParsingFailed}
          currentReview={currentReview}
          isAnalyzing={isAnalyzing}
          setActiveHighlightId={setActiveHighlightId}
          activeHighlightId={activeHighlightId}
        />
      </aside>

      {/* RIGHT PANE: RESUME VIEW & JD INPUT */}
      <div className="flex-1 flex flex-col min-w-0 ">
        <ResumeSection
          isParsed={isParsed}
          isJdPaneOpen={isJdPaneOpen}
          existingResumes={existingResumes}
          linkedResume={linkedResume}
          activeHighlightId={activeHighlightId}
          isResumeLinked={isResumeLinked}
          isParsingFailed={isParsingFailed}
          setCurrentReview={setCurrentReview}
          reviewId={review.id}
        />

        <JdSection
          isJdPaneOpen={isJdPaneOpen}
          setIsJdPaneOpen={setIsJdPaneOpen}
          isParsed={isParsed}
          isAnalyzing={isAnalyzing}
          initialJd={initialJd}
          reviewId={review.id}
          runAnalysis={runAnalysis}
        />
      </div>
    </div>
  );
}
