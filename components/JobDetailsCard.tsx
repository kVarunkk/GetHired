"use client";

import { useState } from "react";
import { ArrowDown, Loader2, Sparkle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { IJob, IJobPosting } from "@/lib/types"; // Assuming IJob is fully typed
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

export default function JobDescriptionCard({
  job,
  user,
  page = "all-jobs",
}: {
  job: IJob | IJobPosting;
  user?: User | null;
  page?: "job-posts" | "all-jobs";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAISummary, setIsAISummary] = useState(false);

  // Initialize state with the existing summary from the server prop
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
        // Pass the job ID required by the API route
        body: JSON.stringify({ job_id: jobId }),
      });

      if (!response.ok) {
        // Attempt to read the error body
        const errorResult = await response.json();
        throw new Error(
          errorResult.error ||
            `AI Summary failed with status ${response.status}`
        );
      }

      const result = await response.json();
      const newSummary = result.summary;

      // Update local state with the new summary
      setAiSummary(newSummary);
      // toast.success("AI Summary generated successfully!");
    } catch (error) {
      console.error("AI Summarization Error:", error);
      toast.error(`Failed to generate summary: ${(error as Error).message}.`);

      // Crucial: Reset the summary view back to original description if API fails
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
        // Case 1: Switching back to Original Description
        setIsAISummary(false);
      } else {
        // Case 2: Switching to AI Summary View

        if (aiSummary) {
          // Summary already exists in state, just show it
          setIsAISummary(true);
        } else if ((job as IJob).ai_summary) {
          // Summary exists on the job prop (first time after server render), use it
          setAiSummary((job as IJob).ai_summary);
          setIsAISummary(true);
        } else {
          // Case 3: Summary does not exist, initiate API call
          setIsAISummary(true);
          setIsExpanded(true); // Auto-expand when generating summary
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
            {page === "all-jobs" && (
              <Button
                variant={"link"}
                className="underline pl-0 sm:pl-3"
                onClick={handleAISummary}
                // Disable button while loading or if description is missing
                disabled={isLoading || !job.description}
              >
                {!isLoading && !isAISummary && <Sparkle className="h-4 w-4 " />}
                {isLoading ? (
                  <>
                    {/* <Loader2 className="animate-spin h-4 w-4 mr-2" />{" "} */}
                    Processing...
                  </>
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
          <div className="whitespace-pre-line">
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
