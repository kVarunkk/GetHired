"use client";

import { useState } from "react";
import { ArrowDown, Loader2, Sparkle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { IJob, IJobPosting } from "@/lib/types";
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

export default function JobDescriptionCard({
  job,
  user,
  page = "all-jobs",
  isCompanyUser = false,
}: {
  job: IJob | IJobPosting;
  user?: User | null;
  page?: "job-posts" | "all-jobs";
  isCompanyUser?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAISummary, setIsAISummary] = useState(false);

  const [aiSummary, setAiSummary] = useState(
    page === "all-jobs" ? (job as IJob).ai_summary : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const toggleDescription = () => {
    setIsExpanded(!isExpanded);
  };

  const fetchAISummary = async (jobId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/summarize/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });

      if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(
          errorResult.error ||
            `AI Summary failed with status ${response.status}`
        );
      }

      const result = await response.json();
      const newSummary = result.summary;

      setAiSummary(newSummary);
    } catch (error) {
      console.error("AI Summarization Error:", error);
      toast.error(`Failed to generate summary: ${(error as Error).message}.`);

      setIsAISummary(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAISummary = () => {
    if (!user) {
      router.push("/auth/sign-up?returnTo=/jobs/" + job.id);
      return;
    } else {
      if (isAISummary) {
        setIsAISummary(false);
      } else {
        if (aiSummary) {
          setIsAISummary(true);
        } else if ((job as IJob).ai_summary) {
          setAiSummary((job as IJob).ai_summary);
          setIsAISummary(true);
        } else {
          setIsAISummary(true);
          setIsExpanded(true);
          fetchAISummary(job.id);
        }
      }
    }
  };

  // Determine the content to display
  let displayedContent = job.description;
  if (isAISummary) {
    displayedContent = aiSummary || job.description; // Fallback to description if summary is null/empty
  }

  return (
    <div className="md:col-span-2 ">
      <Card className="shadow-sm border">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xl font-semibold">
              Job Description
            </CardTitle>
            {page === "all-jobs" && !isCompanyUser && (
              <Button
                variant={"link"}
                className="underline pl-0 sm:pl-3"
                onClick={handleAISummary}
                disabled={isLoading || !job.description}
              >
                {!isLoading && !isAISummary && <Sparkle className="h-4 w-4 " />}
                {isLoading ? (
                  <>Processing...</>
                ) : !user ? (
                  "Sign up to Summarize with AI"
                ) : isAISummary ? (
                  "Show Original"
                ) : (
                  "Summarize with AI"
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent
          className={cn(
            "max-h-[400px] overflow-hidden group relative transition-all duration-300",
            isExpanded && "max-h-[1000px] overflow-y-auto"
          )}
        >
          <div
            className="whitespace-pre-line"
            style={{ overflowWrap: "anywhere" }}
          >
            {isLoading ? (
              <div className="flex flex-col gap-3 items-center w-full min-h-[200px] justify-center">
                <Loader2 className="animate-spin h-6 w-6 mx-auto" />
                <span className="text-sm text-muted-foreground">
                  Generating AI Summary...
                </span>
              </div>
            ) : (
              displayedContent
            )}
          </div>
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex items-center justify-center pt-8 bg-gradient-to-t from-background via-background/90 to-transparent transition-all duration-300 !rounded-b-xl",
              isExpanded ? "opacity-0 invisible" : "opacity-100 visible"
            )}
          >
            <button
              onClick={toggleDescription}
              className="flex items-center justify-center gap-1 text-primary hover:underline font-semibold w-full mb-5"
            >
              <ArrowDown className="h-4 w-4" />
              Show more
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
