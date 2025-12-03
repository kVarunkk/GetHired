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
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

import { getTimeLeftHours } from "@/lib/utils";
import { User } from "@supabase/supabase-js";
import toast from "react-hot-toast";
import { Copy, Loader2 } from "lucide-react";
import Link from "next/link";

const hoursLeft = getTimeLeftHours();

export default function AskAIDialog({
  user,
  isOpen,
  setIsOpen,
  jobId,
}: {
  user: User;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  jobId: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchUses, setSearchUses] = useState(0);
  const searchInputRef = useRef<HTMLTextAreaElement>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);

  const fetchUserData = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_info")
      .select("ask_ai_job_uses, filled")
      .eq("user_id", user.id)
      .single();
    if (data && !error) {
      setIsOnboardingComplete(data.filled);
      return data.ask_ai_job_uses;
    } else return null;
  }, [user]);

  const updateUserData = async (search_uses: number) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("user_info")
      .update({ ask_ai_job_uses: search_uses + 1 })
      .eq("user_id", user.id);
    if (!error) {
      setSearchUses((prev) => prev + 1);
    }
  };

  useEffect(() => {
    (async () => {
      const search_uses = await fetchUserData();
      setSearchUses(search_uses);
    })();
  }, [fetchUserData]);

  const handleSubmit = async (formData?: FormData) => {
    setError(null);
    const search_uses = await fetchUserData();
    if (search_uses >= 5) {
      setError("No more Searches left today :(. Resets every day.");
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

      await updateUserData(search_uses);

      //   setIsOpen(false);
    } catch (error) {
      toast.error(
        `Search failed: ${(error as Error).message}. Please try again.`
      );
      //   console.error("AI Search Error:", error);
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
          <DialogDescription>
            {5 - searchUses} Questions left today. Resets in {hoursLeft} hours.
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
              // type="text"
              required
              placeholder="e.g., Why do you think you are a good fit for this role?"
              name="searchQuery"
              disabled={isLoading || searchUses >= 5}
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
            <Button disabled={isLoading || searchUses >= 5}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </form>
          <div className="text-center text-muted-foreground">OR</div>
          <Button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isLoading || searchUses >= 5}
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
