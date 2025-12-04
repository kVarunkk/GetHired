"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { TAICredits } from "@/lib/types";
import InfoTooltip from "./InfoTooltip";

export default function AskAIDialog({
  isOpen,
  setIsOpen,
  jobId,
  aiCredits = 0,
  isOnboardingComplete,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  jobId: string;
  aiCredits?: number;
  isOnboardingComplete: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLTextAreaElement>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [creditsState, setCreditsState] = useState<number>(aiCredits);

  const handleSubmit = async (formData?: FormData) => {
    setError(null);
    if (creditsState < TAICredits.AI_SMART_SEARCH_OR_ASK_AI) {
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
        body: JSON.stringify({ userQuery: query }),
      });

      if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(
          errorResult.error ||
            `AI parsing failed with status ${response.status}`
        );
      }

      const { answer } = await response.json();

      setAnswer(answer);
      setCreditsState((prev) => prev - TAICredits.AI_SMART_SEARCH_OR_ASK_AI);
    } catch (error) {
      toast.error(
        `Search failed: ${(error as Error).message}. Please try again.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const copyResult = () => {
    if (answer) {
      navigator.clipboard.writeText(answer);
      toast.success("Copied to clipboard!");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>Ask AI to help you apply for this role</DialogTitle>
          <DialogDescription className="flex items-center">
            {creditsState} AI Credits available.
            <InfoTooltip
              content={
                "This feature uses " +
                TAICredits.AI_SMART_SEARCH_OR_ASK_AI +
                " AI credits per use."
              }
            />
          </DialogDescription>
        </DialogHeader>
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
                isLoading || creditsState < TAICredits.AI_SMART_SEARCH_OR_ASK_AI
              }
              className="bg-input text-sm"
              ref={searchInputRef}
            />

            {error && (
              <div className="flex items-center gap-2 text-sm">
                <p className="text-red-600 ">{error}</p>
                {!isOnboardingComplete && (
                  <Link
                    href={"/get-started?edit=true"}
                    className="text-blue-400 underline"
                  >
                    Complete Profile
                  </Link>
                )}
              </div>
            )}
            <Button
              disabled={
                isLoading || creditsState < TAICredits.AI_SMART_SEARCH_OR_ASK_AI
              }
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </form>
          <div className="text-center text-muted-foreground">OR</div>
          <Button
            type="button"
            onClick={() => handleSubmit()}
            disabled={
              isLoading || creditsState < TAICredits.AI_SMART_SEARCH_OR_ASK_AI
            }
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate Cover Letter
          </Button>
        </div>
        {answer && (
          <div className="mt-4 p-4 border rounded-md">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold">Result</h3>
              <Button
                size={"icon"}
                variant={"ghost"}
                onClick={() => copyResult()}
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
