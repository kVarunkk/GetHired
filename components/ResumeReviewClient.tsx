"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import BackButton from "./BackButton";
import ResumeSection from "./resume-review/ResumeSection";
import JdSection from "./resume-review/JdSection";
import {
  TResumeReviewResume,
  TResumeReviewServer,
} from "@/utils/types/review.types";
import AnalysisPane from "./resume-review/AnalysisPane";
import { markAnalysisAsFailedAction } from "@/app/actions/mark-review-analysis-failed";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/utils/utils";

interface ReviewWorkspaceProps {
  initialReview: TResumeReviewServer;
  initialJd: string;
  existingResumes: TResumeReviewResume[];
}

export default function ResumeReviewClient({
  initialReview,
  initialJd,
  existingResumes,
}: ReviewWorkspaceProps) {
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null,
  );
  const [isJdPaneOpen, setIsJdPaneOpen] = useState(true);
  const [activeTriggerState, setActiveTriggerState] = useState<
    "idle" | "saving_jd" | "triggering_analysis" | "triggering_parse"
  >("idle");

  const cacheKey = `/api/resume-review/${initialReview.id}`;
  const {
    data: { data: review },
  } = useSWR(cacheKey, fetcher, {
    fallbackData: { data: initialReview },
    refreshInterval: (swrRootData) => {
      const data = swrRootData?.data;
      const isParsing =
        (data?.resume_id &&
          !data?.resumes?.content &&
          !data?.resumes?.parsing_failed) ||
        activeTriggerState === "triggering_parse";
      const isAnalyzing =
        data?.status === "processing" ||
        activeTriggerState === "triggering_analysis";
      return isParsing || isAnalyzing ? 2000 : 0;
    },
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  useEffect(() => {
    if (!activeHighlightId) return;
    const element = document.getElementById(`bullet-${activeHighlightId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeHighlightId]);

  const linkedResume = review?.resumes;
  const isResumeLinked = !!review?.resume_id;
  const isParsed = !!linkedResume?.content;
  const isParsingFailed = !!linkedResume?.parsing_failed;
  const isAnalyzing = review?.status === "processing";

  const runAnalysis = async () => {
    try {
      const res = await fetch("/api/resume-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: review.id,
        }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "API routing processing failed");
      }

      mutate(cacheKey);
    } catch (error) {
      mutate(cacheKey, (currentReview) => ({
        ...currentReview,
        status: "failed",
        analysis_failed: true,
      }));
      await markAnalysisAsFailedAction(review.id);
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      changeTriggerState("idle");
    }
  };

  const changeTriggerState = (
    state: "idle" | "saving_jd" | "triggering_analysis" | "triggering_parse",
  ) => {
    setActiveTriggerState(state);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:h-[calc(100vh)] sm:overflow-hidden bg-background">
      {/* LEFT PANE: ANALYSIS & SUGGESTIONS */}
      <aside className="sm:w-[40%] border-r flex flex-col ">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="flex flex-col ">
              <h2 className="text-lg font-bold">Analysis Pane</h2>
              <p className=" text-muted-foreground text-sm">{review?.name}</p>
            </div>
          </div>
          {review?.score && (
            <div className="text-right">
              <div className="text-2xl font-black text-brand">
                {review.score}
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
          currentReview={review}
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
          reviewId={review?.id}
          changeTriggerState={changeTriggerState}
        />

        <JdSection
          isJdPaneOpen={isJdPaneOpen}
          setIsJdPaneOpen={setIsJdPaneOpen}
          isParsed={isParsed}
          isAnalyzing={isAnalyzing}
          initialJd={initialJd}
          reviewId={review?.id}
          runAnalysis={runAnalysis}
          changeTriggerState={changeTriggerState}
        />
      </div>
    </div>
  );
}
