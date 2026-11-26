"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import toast from "react-hot-toast";
import { markScreeningReviewedAction } from "@/app/actions/interviews/mark-screening-reviewed";
import { Button } from "@/components/ui/button";

/** On a finished AI interview's report, for interviews.manage. */
export default function MarkReviewedButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const mark = async () => {
    setBusy(true);
    try {
      const result = await markScreeningReviewedAction({ id: interviewId });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Marked as reviewed.");
        router.refresh();
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="brand" size="sm" disabled={busy} onClick={() => void mark()}>
      <Check />
      {busy ? "Saving…" : "Mark reviewed"}
    </Button>
  );
}
