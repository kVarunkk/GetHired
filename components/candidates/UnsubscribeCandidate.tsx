"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { unsubscribeCandidateAction } from "@/app/actions/candidates/unsubscribe";
import { Button } from "@/components/ui/button";

/**
 * BI-REQ-034: the unsubscribe button. A button rather than the link itself,
 * so a mail scanner opening the link doesn't unsubscribe anyone.
 */
export default function UnsubscribeCandidate({ token, companyName }: { token: string; companyName: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        You&apos;re unsubscribed. {companyName} won&apos;t email you through GetHired again.
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
              const result = await unsubscribeCandidateAction({ token });
              if (result.ok) {
                setState("done");
                return;
              }
              setError(result.error);
            } catch {
              setError("Couldn't unsubscribe you. Try again.");
            }
            setState("idle");
          }}
        >
          {state === "busy" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Unsubscribe
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
