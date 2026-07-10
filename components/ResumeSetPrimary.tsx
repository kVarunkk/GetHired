"use client";

import { setPrimaryResumeAction } from "@/app/actions/set-primary-resume";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { Star } from "lucide-react";
import { Dispatch, SetStateAction } from "react";
import toast from "react-hot-toast";

export default function ResumeSetPrimary({
  isProcessing,
  setIsProcessing,
  isPrimary,
  setItems,
  items,
  resumeId,
}: {
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isPrimary: boolean;
  setItems: Dispatch<SetStateAction<TResumeReviewResume[]>>;
  items: TResumeReviewResume[];
  resumeId: string;
}) {
  const handleSetPrimary = async (resumeId: string) => {
    // Capture previous items array for structural rollback if server rejects request
    const previousItems = [...items];

    try {
      setIsProcessing(true);

      // Step 1: Optimistic UI Update (Immediate visual feedback)
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          is_primary: item.id === resumeId,
        })),
      );

      // Step 2: Invoke the Server Action
      const result = await setPrimaryResumeAction(resumeId);

      if (result.error) {
        // Rollback optimistic state if the server operation explicitly returned a failure status
        setItems(previousItems);
        toast.error(result.error);
        return;
      }

      toast.success(
        "Primary resume updated. Your profile is being updated in the background.",
      );
    } catch {
      // Rollback optimistic state if network connection drop occurs
      setItems(previousItems);
      toast.error("An unexpected error occurred.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={() => !isPrimary && handleSetPrimary(resumeId)}
        disabled={isPrimary || isProcessing}
        title={isPrimary ? "Current Primary" : "Set as Primary"}
      >
        <Star
          size={16}
          className={`${isPrimary && "fill-black dark:fill-white"}`}
        />
      </button>
    </div>
  );
}
