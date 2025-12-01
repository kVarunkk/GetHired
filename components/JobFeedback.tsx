"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "./ui/button";
import { useState, useTransition } from "react";
import { submitJobFeedback } from "@/app/actions/jobs-feedback";

type VoteType = "upvote" | "downvote";
type CurrentVote = "upvote" | "downvote" | null;

interface JobsFeedbackProps {
  jobId: string;
  initialVote: CurrentVote;
}

export default function JobsFeedback({
  jobId,
  initialVote,
}: JobsFeedbackProps) {
  const [userVote, setUserVote] = useState<CurrentVote>(initialVote);
  const [isPending, startTransition] = useTransition();

  const handleVote = (voteType: VoteType) => {
    if (isPending) return;

    const newVote = userVote === voteType ? null : voteType;

    const oldVote = userVote;
    setUserVote(newVote);

    startTransition(async () => {
      const result = await submitJobFeedback(jobId, newVote);

      if (!result.success) {
        setUserVote(oldVote);
      }
    });
  };

  return (
    <div className="flex items-center text-sm mt-2">
      <Button
        variant={"ghost"}
        size={"icon"}
        onClick={() => handleVote("upvote")}
        disabled={isPending}
      >
        <ThumbsUp
          className={`h-5 w-5 ${
            userVote === "upvote" && "fill-current text-primary"
          }`}
        />
      </Button>

      <Button
        variant={"ghost"}
        size={"icon"}
        onClick={() => handleVote("downvote")}
        disabled={isPending}
      >
        <ThumbsDown
          className={`h-5 w-5 ${
            userVote === "downvote" && "fill-current text-primary"
          }`}
        />
      </Button>
    </div>
  );
}
