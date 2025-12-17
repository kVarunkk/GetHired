"use client";

import { Share } from "lucide-react";
import { Button } from "./ui/button";
import toast from "react-hot-toast";

export default function ShareJobPosting({ job_id }: { job_id: string | null }) {
  return (
    <Button
      title={job_id ? "Share Job Post" : "Activate once to share"}
      className="text-muted-foreground hover:text-primary"
      variant={"ghost"}
      disabled={!job_id}
      onClick={() => {
        navigator.clipboard.writeText(
          window.location.origin + "/jobs/" + job_id
        );
        toast.success("Job link copied to clipboard!");
      }}
    >
      <Share className="h-4 w-4" />
    </Button>
  );
}
