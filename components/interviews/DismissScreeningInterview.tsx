"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { dismissScreeningInterviewAction } from "@/app/actions/interviews/dismiss-screening-interview";

/** Takes a screening interview off the dashboard. It comes back if the company acts on it. */
export default function DismissScreeningInterview({ id, jobTitle }: { id: string; jobTitle: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-8 w-8 shrink-0 text-muted-foreground"
      aria-label={`Remove ${jobTitle} from dashboard`}
      title="Remove from dashboard"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await dismissScreeningInterviewAction({ id });
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      <X className="h-4 w-4" />
    </Button>
  );
}
