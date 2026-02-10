"use client";

import { createClient } from "@/lib/supabase/client";
import { IResume } from "@/lib/types";
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
  // updateLocalItem
}: {
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isPrimary: boolean;
  setItems: Dispatch<SetStateAction<IResume[]>>;
  items: IResume[];
  resumeId: string;
  // updateLocalItem: (updatedItem: IResume) => void
}) {
  //   const [isLoading, setIsLoading] = useState(false);

  const handleSetPrimary = async (resumeId: string) => {
    try {
      //   setIsLoading(true);
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
        }))
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

      toast.success("Primary resume updated");
    } catch {
      // console.error("Failed to set primary:", err);
      toast.error("Could not update primary resume");
    } finally {
      //   setProcessingId(null);
      //   setIsLoading(false);
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
