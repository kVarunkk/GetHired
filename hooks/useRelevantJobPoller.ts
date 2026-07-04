import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mutate } from "swr";
import { JOB_POSTING_API_KEY, PROFILE_API_KEY } from "@/utils/utils";

interface PollerOptions {
  userId: string | null;
  isGenerated: boolean;
  isSuitable: boolean;
  isSimilarSearch: boolean;
  currentPage: string;
  isFailed: boolean;
  isRelevantProfileSearch: boolean;
  jobPostingId: string | null;
  loading: boolean;
}

/**
 * Polls the `user_info.is_relevant_jobs_generated` flag until it becomes true.
 * when that happens it deducts a credit, invalidates caches and refreshes the
 * router.  The caller is responsible for tracking the `isGenerated` value; the
 * hook only performs the side effects.
 */
export function useRelevantJobPoller({
  loading,
  userId,
  isGenerated,
  isSuitable,
  isSimilarSearch,
  currentPage,
  isFailed,
  isRelevantProfileSearch,
  jobPostingId,
}: PollerOptions) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  useEffect(() => {
    console.log(
      "isLoading",
      loading,
      "generated",
      isGenerated,
      "failed",
      isFailed,
      "issuitable negation",
      !isSuitable,
      "current page",
      currentPage,
      "similar search",
      isSimilarSearch,
      "userId",
      userId,
      "relevant profile search negation",
      !isRelevantProfileSearch,
    );

    if (
      loading ||
      isGenerated ||
      isFailed ||
      !isSuitable ||
      (currentPage === "jobs" && (isSimilarSearch || !userId)) ||
      (currentPage === "profiles" && !isRelevantProfileSearch)
    ) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    const checkFlag = async () => {
      const supabase = createClient();

      let completed = false;

      if (isRelevantProfileSearch) {
        const { data, error } = await supabase
          .from("job_postings")
          .select("matching_status")
          .eq("id", jobPostingId!)
          .single();

        if (error) {
          timeoutId = setTimeout(checkFlag, 1000);
          return;
        }

        completed =
          data?.matching_status === "completed" ||
          data?.matching_status === "failed";
      } else {
        const { data, error } = await supabase
          .from("user_info")
          .select("relevant_jobs_update_status")
          .eq("user_id", userId!)
          .single();

        console.log("data from polling hook: ", data);

        if (error) {
          timeoutId = setTimeout(checkFlag, 1000);
          return;
        }

        completed =
          data?.relevant_jobs_update_status === "completed" ||
          data?.relevant_jobs_update_status === "failed";
      }

      console.log("COMPLETED: ", completed);

      if (completed) {
        await mutate(
          isRelevantProfileSearch
            ? `${JOB_POSTING_API_KEY}?jobId=${jobPostingId}`
            : PROFILE_API_KEY,
        );
        startTransition(() => {
          router.refresh();
        });
      } else {
        timeoutId = setTimeout(checkFlag, 1000);
      }
    };

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
    isRelevantProfileSearch,
    jobPostingId,
    loading,
  ]);

  return { isRefreshing };
}
