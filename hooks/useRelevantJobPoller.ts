import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mutate } from "swr";
import { revalidateCache } from "@/app/actions/revalidate";
import { deductCreditsForUser } from "@/app/actions/deduct-credits";
import { PROFILE_API_KEY } from "@/utils/utils";

interface PollerOptions {
  userId: string | null;
  isGenerated: boolean; // initial/generated flag from server data
  isSuitable: boolean;
  isSimilarSearch: boolean;
  currentPage: string;
  isFailed: boolean;
}

/**
 * Polls the `user_info.is_relevant_jobs_generated` flag until it becomes true.
 * when that happens it deducts a credit, invalidates caches and refreshes the
 * router.  The caller is responsible for tracking the `isGenerated` value; the
 * hook only performs the side effects.
 */
export function useRelevantJobPoller({
  userId,
  isGenerated,
  isSuitable,
  isSimilarSearch,
  currentPage,
  isFailed,
}: PollerOptions) {
  const router = useRouter();

  useEffect(() => {
    if (
      isGenerated ||
      currentPage !== "jobs" ||
      !isSuitable ||
      isSimilarSearch ||
      isFailed ||
      !userId
    )
      return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const checkFlag = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("user_info")
        .select("is_relevant_jobs_generated")
        .eq("user_id", userId)
        .single();

      if (data?.is_relevant_jobs_generated) {
        await deductCreditsForUser(userId);
        await mutate(PROFILE_API_KEY);
        await revalidateCache("jobs-feed");
        router.refresh();
      } else {
        // schedule another poll
        timeoutId = setTimeout(checkFlag, 2000);
      }
    };

    // kick off
    checkFlag();

    return () => clearTimeout(timeoutId);
  }, [
    isGenerated,
    userId,
    router,
    currentPage,
    isSuitable,
    isSimilarSearch,
    isFailed,
  ]);
}
