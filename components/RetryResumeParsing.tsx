"use client";

import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { retryResumeParsingAction } from "@/app/actions/retry-resume-parsing";

export const RetryResumeParsing = ({ resumeId }: { resumeId: string }) => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const retryResumeParsing = async () => {
    if (!resumeId) return;

    setIsLoading(true);
    const toastId = toast.loading("Restarting document synchronization...");

    try {
      const result = await retryResumeParsingAction(resumeId);

      if (result.error) {
        throw new Error(result.error);
      }

      toast.success(
        "Sync restarted. You'll be notified via email once the process is completed.",
        { id: toastId },
      );

      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to restart sync. Please try again.",
        {
          id: toastId,
        },
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button onClick={retryResumeParsing} variant={"destructive"}>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {/* <Sparkle className="h-4 w-4" /> */}
      Retry Parsing
    </Button>
  );
};
