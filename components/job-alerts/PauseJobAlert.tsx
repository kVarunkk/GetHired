"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { pauseJobAlertFromEmailAction } from "@/app/actions/job-alerts/pause-job-alert-from-email";
import { Button } from "@/components/ui/button";
import { JOB_ALERTS_SETTINGS_PATH } from "@/helpers/job-alerts/paths";

/** JA-REQ-036: the pause page's button. */
export default function PauseJobAlert({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        Alert paused. Turn it back on any time in{" "}
        <Link
          href={JOB_ALERTS_SETTINGS_PATH}
          className="underline underline-offset-4"
        >
          Settings
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            setError(null);
            try {
              const result = await pauseJobAlertFromEmailAction({ token });
              if (result.ok) {
                setState("done");
                return;
              }
              setError(result.error);
            } catch {
              setError("Couldn't pause the alert. Try again.");
            }
            setState("idle");
          }}
        >
          {state === "busy" && <Loader2 className="h-4 w-4 animate-spin" />}
          Pause alert
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
