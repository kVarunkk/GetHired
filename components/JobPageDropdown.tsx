"use client";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "./ui/button";
import { Check, File, KanbanSquare, MoreHorizontal, Share2, Trash } from "lucide-react";
import toast from "react-hot-toast";
import { setExternalApplicationStatusAction } from "@/app/actions/applications/set-external-application-status";
import { removeExternalApplicationAction } from "@/app/actions/applications/remove-external-application";
import { copyToClipboard, PROFILE_API_KEY } from "@/utils/utils";
import { mutate } from "swr";
import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { APPLIED_STATUSES, trackedStatusLabel, type AppliedStatus } from "@/helpers/tracker/status";
import { myJobsPath, trackedApplicationPath } from "@/helpers/tracker/paths";

type ProfileRow = { id?: string; all_jobs_id: string | null; status: string };
type ProfileCache = { profile?: { applications?: ProfileRow[]; tracked_applications?: ProfileRow[] } } | undefined;

/**
 * The job page's menu (AT-REQ-035). For an external job the user tracks, it
 * moves or removes the tracker card and opens it in My Jobs. The actions
 * copy an old external application into the tracker first.
 */
export default function JobPageDropdown({
  userId,
  jobId,
  isCompanyUser,
  applicationStatus,
  trackedId = null,
  isPlatformJob,
}: {
  userId: string | null;
  jobId: string;
  isCompanyUser: boolean;
  /** The tracked status of this job's card, or null when it isn't tracked. */
  applicationStatus: AppliedStatus | null;
  /** The card's id, for "Open in My Jobs"; null for an old row not moved yet. */
  trackedId?: string | null;
  isPlatformJob: boolean;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const canTrack = !isCompanyUser && Boolean(userId) && Boolean(applicationStatus) && !isPlatformJob;

  // The job's old applications row is copied into the tracker by the action,
  // so the cache drops it and keeps one tracked row.
  const optimistic = (change: (rows: ProfileRow[]) => ProfileRow[]) =>
    mutate(
      PROFILE_API_KEY,
      (current: ProfileCache) => {
        if (!current?.profile) return current;
        const profile = current.profile;
        return {
          ...current,
          profile: {
            ...profile,
            applications: (profile.applications ?? []).filter((row) => row.all_jobs_id !== jobId),
            tracked_applications: change(profile.tracked_applications ?? []),
          },
        };
      },
      false,
    );

  const updateApplicationStatus = async (status: AppliedStatus) => {
    if (!canTrack) return;
    try {
      optimistic((rows) => {
        const others = rows.filter((row) => row.all_jobs_id !== jobId);
        return [...others, { id: trackedId ?? undefined, all_jobs_id: jobId, status }];
      });
      const result = await setExternalApplicationStatusAction({ allJobsId: jobId, status });
      if (!result.ok) throw new Error(result.error);
      mutate(PROFILE_API_KEY);
      toast.success("Application status updated.");
    } catch (err) {
      mutate(PROFILE_API_KEY);
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  const removeApplication = async () => {
    if (!canTrack) return;
    try {
      optimistic((rows) => rows.filter((row) => row.all_jobs_id !== jobId));
      const result = await removeExternalApplicationAction({ allJobsId: jobId });
      if (!result.ok) throw new Error(result.error);
      mutate(PROFILE_API_KEY);
      toast.success("Removed from My Jobs.");
    } catch (err) {
      mutate(PROFILE_API_KEY);
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button className="p-2" variant={"ghost"} aria-label="Job actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {canTrack && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <File className="h-4 w-4 " />
                Update Status
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {APPLIED_STATUSES.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      className="flex items-center justify-between"
                      onClick={() => updateApplicationStatus(status)}
                    >
                      {trackedStatusLabel(status)}
                      {applicationStatus === status ? <Check className="h-4 w-4 " /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {canTrack && (
            <DropdownMenuItem asChild>
              <Link href={trackedId ? trackedApplicationPath(trackedId) : myJobsPath({ tab: "applications" })}>
                <KanbanSquare className="h-4 w-4" />
                Open in My Jobs
              </Link>
            </DropdownMenuItem>
          )}
          {canTrack && (
            <DropdownMenuItem
              onClick={() => setConfirmingRemove(true)}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <Trash className="h-4 w-4" />
              Remove Application
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              copyToClipboard(window.location.href, "Job link copied to clipboard!");
            }}
          >
            <Share2 className="h-4 w-4" />
            Share Job
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Remove this application?"
        description="It's removed from My Jobs, along with its status, notes and timeline. This can't be undone."
        confirmLabel="Remove"
        onConfirm={removeApplication}
      />
    </>
  );
}
