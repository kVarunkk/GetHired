"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteResumeDialog from "./DeleteResumeDialog";

/**
 * Delete on the resume page (RE-REQ-037), behind a "More" menu so it sits apart
 * from Edit and Export. When it's off, the item says why. After a delete the
 * user goes back to the list.
 */
export default function ResumeDeleteMenu({
  resume,
  deleteBlocked,
}: {
  resume: { id: string; name: string | null };
  /** From `resumeDeleteBlockedReason`; null when the resume can be deleted. */
  deleteBlocked: string | null;
}) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={deleteBlocked !== null} onSelect={() => setIsConfirming(true)}>
            <Trash2 className="h-4 w-4" />
            {deleteBlocked ? (
              <span className="flex flex-col">
                Delete
                <span className="text-xs text-muted-foreground">{deleteBlocked}</span>
              </span>
            ) : (
              "Delete"
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteResumeDialog
        resume={resume}
        open={isConfirming}
        onOpenChange={setIsConfirming}
        onDeleted={() => {
          router.push("/resume");
          router.refresh();
        }}
      />
    </>
  );
}
