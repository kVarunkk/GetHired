"use client";

import { createResumeReviewAction } from "@/app/actions/create-resume-review";
import { Button } from "./ui/button";
import { useState } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { Loader2, Sparkle } from "lucide-react";

export default function CreateReviewForResume({
  userId,
  resumeId,
}: {
  userId: string;
  resumeId: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const createReview = async () => {
    if (!userId || !resumeId) {
      toast.error("Authentication or Resume data missing.");
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading("Initializing AI Review Workspace...");

    try {
      const formData = new FormData();
      formData.append("userId", userId);
      formData.append("existingResumeId", resumeId);

      const result = await createResumeReviewAction(formData);

      if (result.error) {
        toast.error(result.error, { id: toastId });
        setIsLoading(false);
      } else if (result.success && result.reviewId) {
        toast.success("Workspace ready!", { id: toastId });

        router.push(`/resume-review/${result.reviewId}`);
      }
    } catch (err) {
      console.error("[CREATE_REVIEW_CLIENT_ERROR]:", err);
      toast.error("Failed to initialize review. Please try again.", {
        id: toastId,
      });
      setIsLoading(false);
    }
  };

  return (
    <Button onClick={createReview} disabled={isLoading}>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      <Sparkle className="h-4 w-4" />
      Review this Resume
    </Button>
  );
}
