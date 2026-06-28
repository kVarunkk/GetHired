"use client";

import { createClient } from "@/lib/supabase/client";
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
  userId,
}: {
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isPrimary: boolean;
  setItems: Dispatch<SetStateAction<TResumeReviewResume[]>>;
  items: TResumeReviewResume[];
  resumeId: string;
  userId: string;
}) {
  const handleSetPrimary = async (resumeId: string) => {
    try {
      setIsProcessing(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Unauthorized");

      // Step 1: Optimistic UI Update
      const previousItems = [...items];
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          is_primary: item.id === resumeId,
        })),
      );

      // Step 2: Database Update
      const { error: clearError } = await supabase
        .from("resumes")
        .update({ is_primary: false })
        .eq("user_id", user.id);

      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from("resumes")
        .update({ is_primary: true })
        .eq("id", resumeId);

      if (setError) {
        setItems(previousItems); // Rollback on error
        throw setError;
      }

      toast.success(
        "Primary resume updated. Your profile is being updated in the background.",
      );

      fetch(`/api/update-embedding/gemini/user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
        }),
      }).catch(() => {});
    } catch {
      // console.error("Failed to set primary:", err);
      toast.error("Could not update primary resume");
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
