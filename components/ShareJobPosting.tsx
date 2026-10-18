"use client";

import { Share2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { copyToClipboard } from "@/utils/utils";

/**
 * Copies a job's public link. With a published careers page (CP-REQ-014), it
 * also offers the link to the job inside the careers page.
 */
export default function ShareJobPosting({
  job_id,
  careersSlug = null,
}: {
  job_id: string | null;
  careersSlug?: string | null;
}) {
  const copyBoard = () =>
    copyToClipboard(window.location.origin + "/jobs/" + job_id, "Job link copied to clipboard!");
  const trigger = (
    <Button
      title={job_id ? "Share Job Post" : "Activate once to share"}
      aria-label="Share Job Post"
      className="text-muted-foreground hover:text-primary"
      variant={"ghost"}
      disabled={!job_id}
      onClick={careersSlug ? undefined : copyBoard}
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
  if (!careersSlug || !job_id) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={copyBoard}>Copy job board link</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            copyToClipboard(
              `${window.location.origin}/careers/${careersSlug}/jobs/${job_id}`,
              "Careers page link copied to clipboard!",
            )
          }
        >
          Copy careers page link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
