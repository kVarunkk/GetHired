"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BackLink } from "./PageHeader";
import ResumeSection from "./resume-review/ResumeSection";
import JdSection from "./resume-review/JdSection";
import {
  TResumeReviewResume,
  TResumeReviewServer,
} from "@/utils/types/review.types";
import AnalysisPane from "./resume-review/AnalysisPane";
import { scoreColorClass } from "./resume-review/score";
import { AskAgentAboutResumeReview } from "./agent/AskAgentOnApplicantIdPages";
import { markAnalysisAsFailedAction } from "@/app/actions/mark-review-analysis-failed";
import useSWR, { mutate } from "swr";
import { reviewRefreshInterval, type ReviewTriggerState } from "./resume-review/review-refresh";
import { cn, fetcher } from "@/utils/utils";

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
  const [activeTriggerState, setActiveTriggerState] =
    useState<ReviewTriggerState>("idle");

  const cacheKey = `/api/resume-review/${initialReview.id}`;
  const {
    data: { data: review },
  } = useSWR(cacheKey, fetcher, {
    fallbackData: { data: initialReview },
    refreshInterval: (swrRootData) =>
      reviewRefreshInterval(swrRootData?.data, activeTriggerState),
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
            <BackLink href="/resume-review" label="Back to resume reviews" />
            <div className="flex flex-col ">
              <h2 className="text-lg font-semibold tracking-tight">
                Analysis Pane
              </h2>
              <p className=" text-muted-foreground text-sm">{review?.name}</p>
            </div>
          </div>
          {review?.score && (
            <div className="text-right">
              <div
                className={cn(
                  "text-2xl font-semibold tracking-tight",
                  scoreColorClass(review.score),
                )}
              >
                {review.score}
              </div>
              <div className="text-xs font-medium text-muted-foreground">
                Match Score
              </div>
            </div>
          )}
        </div>

        {/* Only once there's an analysis to ask about. */}
        {review?.ai_response && !review.analysis_failed && (
          <div className="border-b p-4">
            <AskAgentAboutResumeReview
              review={{ id: review.id, name: review.name }}
            />
          </div>
        )}

        <AnalysisPane
          isParsed={isParsed}
          isResumeLinked={isResumeLinked}
          isParsingFailed={isParsingFailed}
          currentReview={review}
          isAnalyzing={isAnalyzing}
          setActiveHighlightId={setActiveHighlightId}
          activeHighlightId={activeHighlightId}
          onRerun={() => {
            changeTriggerState("triggering_analysis");
            runAnalysis();
          }}
        />
      </aside>

      {/* RIGHT PANE: RESUME VIEW & JD INPUT */}
      <div className="flex-1 flex flex-col min-w-0 ">
        <ResumeSection
          isParsed={isParsed}
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
