"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Copy, Loader2, Sparkle } from "lucide-react";
import Link from "next/link";
import { TAICredits } from "@/utils/types";
import InfoTooltip from "./InfoTooltip";
import useSWR, { mutate } from "swr";
import { copyToClipboard, fetcher, PROFILE_API_KEY } from "@/utils/utils";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { TResumeReviewResume } from "@/utils/types/review.types";

export default function AskAIDialog({
  jobId,
  isOnboardingComplete,
}: {
  jobId: string;
  isOnboardingComplete: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLTextAreaElement>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [view, setView] = useState<"form" | "resume">("form");

  const [selectedResume, setSelectedResume] =
    useState<TResumeReviewResume | null>(null);
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const creditsState = data && data.profile ? data.profile.ai_credits : 0;
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  useEffect(() => {
    if (existingResumes && existingResumes.length > 0) {
      const primaryResume = existingResumes.find((resume) => resume.is_primary);
      setSelectedResume(primaryResume || existingResumes[0]);
    }
  }, [existingResumes]);

  const handleSubmit = async (formData?: FormData) => {
    setError(null);
    if (!selectedResume?.id) {
      setError("Please select a resume.");
      return;
    }
    if (creditsState < TAICredits.AI_SEARCH_ASK_AI_RESUME) {
      setError("Insufficient AI credits. Please top up to continue.");
      return;
    }
    if (!isOnboardingComplete) {
      setError("Please complete your profile to use this feature.");
      return;
    }
    const query = formData
      ? formData.get("searchQuery")?.toString()?.trim()
      : "Generate a cover letter for me.";

    if (!query) return;

    if (query.length > 100) {
      setError("Prompt should be shorter than 100 characters.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/ai-search/jobs/questions/" + jobId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuery: query,
          resumeId: selectedResume?.id,
        }),
      });

      if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(
          errorResult.error ||
            `AI parsing failed with status ${response.status}`,
        );
      }

      const { answer } = await response.json();

      setAnswer(answer);
      mutate(PROFILE_API_KEY);
    } catch (error) {
      toast.error(
        `Search failed: ${(error as Error).message}. Please try again.`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={"outline"}>
          <Sparkle className="h-4 w-4" />
          Ask AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>Ask AI to help you apply for this role</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            {creditsState} AI Credits available.{" "}
            <Link href={"/dashboard/buy-credits"} className="text-blue-500">
              Recharge Credits
            </Link>
            <InfoTooltip
              content={
                "This feature uses " +
                TAICredits.AI_SEARCH_ASK_AI_RESUME +
                " AI credits per use."
              }
            />
          </DialogDescription>
        </DialogHeader>

        {view === "resume" ? (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-semibold text-muted-foreground">
              <Button
                type="button"
                onClick={() => setView("form")}
                variant={"link"}
              >
                <ArrowLeft /> Back
              </Button>
            </div>
            <ResumeSourceSelector
              existingResumes={existingResumes}
              selectedId={selectedResume?.id || null}
              onSelectExisting={(id) => {
                const resume =
                  existingResumes?.find((r) => r.id === id) || null;
                setSelectedResume(resume);
              }}
              file={null}
              onFileChange={() => {}}
              view="select"
            />
            {/* <Button type="button">Proceed</Button> */}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-sm flex items-center font-semibold text-muted-foreground">
              {selectedResume ? (
                <div className="flex items-center gap-1">
                  Using
                  <span
                    title={selectedResume?.name ?? "Selected Resume"}
                    className="font-bold inline-block w-[10rem] truncate"
                  >
                    {selectedResume?.name}
                  </span>
                </div>
              ) : (
                <p>Select a Resume</p>
              )}
              <Button
                variant={"link"}
                onClick={() => setView("resume")}
                className="text-muted-foreground font-semibold underline"
              >
                Change
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  handleSubmit(formData);
                }}
                className="flex flex-col space-y-4"
              >
                <Textarea
                  required
                  placeholder="e.g., Why do you think you are a good fit for this role?"
                  name="searchQuery"
                  disabled={
                    isLoading ||
                    creditsState < TAICredits.AI_SEARCH_ASK_AI_RESUME
                  }
                  className="bg-input text-sm"
                  ref={searchInputRef}
                />

                {error && (
                  <div className="flex items-center gap-2 text-sm">
                    <p className="text-red-600 ">{error}</p>
                    {!isOnboardingComplete && (
                      <Link
                        href={"/get-started"}
                        className="text-blue-400 underline"
                      >
                        Complete Profile
                      </Link>
                    )}
                  </div>
                )}
                <Button
                  disabled={
                    isLoading ||
                    creditsState < TAICredits.AI_SEARCH_ASK_AI_RESUME
                  }
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Submit
                </Button>
              </form>
              <div className="text-center text-muted-foreground">OR</div>
              <Button
                type="button"
                onClick={() => handleSubmit()}
                disabled={
                  isLoading || creditsState < TAICredits.AI_SEARCH_ASK_AI_RESUME
                }
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate Cover Letter
              </Button>
            </div>
          </div>
        )}

        {answer && (
          <div className="mt-4 p-4 border rounded-md">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold">Result</h3>
              <Button
                size={"icon"}
                variant={"ghost"}
                onClick={() => copyToClipboard(answer, "Copied to Clipboard")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p
              className="whitespace-pre-wrap"
              style={{ overflowWrap: "anywhere" }}
            >
              {answer}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
