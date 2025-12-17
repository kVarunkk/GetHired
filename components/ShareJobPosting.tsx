"use client";

import { Share } from "lucide-react";
import { Button } from "./ui/button";
import { copyToClipboard } from "@/lib/utils";

export default function ShareJobPosting({ job_id }: { job_id: string | null }) {
  return (
    <Button
      title={job_id ? "Share Job Post" : "Activate once to share"}
      className="text-muted-foreground hover:text-primary"
      variant={"ghost"}
      disabled={!job_id}
      onClick={() => {
        copyToClipboard(
          window.location.origin + "/jobs/" + job_id,
          "Job link copied to clipboard!"
        );
      }}
    >
      <Share className="h-4 w-4" />
    </Button>
  );
}
