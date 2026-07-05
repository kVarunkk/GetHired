"use client";
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
import { Check, File, MoreHorizontal, Share2, Trash } from "lucide-react";
import toast from "react-hot-toast";
import { TApplicationStatus } from "@/utils/types";
import { createClient } from "@/lib/supabase/client";
import { copyToClipboard, PROFILE_API_KEY } from "@/utils/utils";
import { mutate } from "swr";

const applicationStatuses = Object.values(TApplicationStatus);

export default function JobPageDropdown({
  userId,
  jobId,
  isCompanyUser,
  applicationStatus,
  isPlatformJob,
}: {
  userId: string | null;
  jobId: string;
  isCompanyUser: boolean;
  applicationStatus: TApplicationStatus | null;
  isPlatformJob: boolean;
}) {
  const updateApplicationStatus = async (status: TApplicationStatus) => {
    try {
      if (!userId || isCompanyUser || !applicationStatus || isPlatformJob) {
        return;
      }
      mutate(
        PROFILE_API_KEY,
        (currentData) => {
          if (!currentData) return currentData;

          const profile = currentData.profile || {};

          return {
            ...currentData,
            profile: {
              ...profile,
              applications: profile.applications.map(
                (_: { all_jobs_id: string; status: string }) => {
                  if (_.all_jobs_id === jobId) {
                    return {
                      ..._,
                      status: status,
                    };
                  }
                  return _;
                },
              ),
            },
          };
        },
        false,
      );

      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .update({ status: status, updated_at: new Date().toISOString() })
        .eq("all_jobs_id", jobId)
        .eq("applicant_user_id", userId);

      if (error) throw error;

      mutate(PROFILE_API_KEY);

      toast.success("Application status updated.");
    } catch {
      toast.error("An unexpected error occurred.");
    }
  };

  const removeApplication = async () => {
    try {
      if (!userId || isCompanyUser || !applicationStatus || isPlatformJob) {
        return;
      }

      mutate(
        PROFILE_API_KEY,
        (currentData) => {
          if (!currentData) return currentData;

          const profile = currentData.profile || {};

          return {
            ...currentData,
            profile: {
              ...profile,
              applications: profile.applications.filter(
                (_: { all_jobs_id: string; status: string }) =>
                  _.all_jobs_id !== jobId,
              ),
            },
          };
        },
        false,
      );

      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .delete()
        .eq("all_jobs_id", jobId)
        .eq("applicant_user_id", userId);

      if (error) throw error;

      mutate(PROFILE_API_KEY);

      toast.success("Application removed succesfully.");
    } catch {
      toast.error("An unexpected error occurred.");
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button className="p-2" variant={"ghost"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!isCompanyUser && userId && applicationStatus && !isPlatformJob && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <File className="h-4 w-4 " />
                Update Status
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {applicationStatuses
                    .filter(
                      (_) =>
                        _ !== TApplicationStatus.STAND_BY &&
                        _ !== TApplicationStatus.REVIEWED,
                    )
                    .map((status) => (
                      <DropdownMenuItem
                        key={status}
                        className="capitalize flex items-center justify-between"
                        onClick={() => updateApplicationStatus(status)}
                      >
                        {status}
                        {applicationStatus === status ? (
                          <Check className="h-4 w-4 " />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {!isCompanyUser && userId && applicationStatus && !isPlatformJob && (
            <DropdownMenuItem
              onClick={() => {
                removeApplication();
              }}
              className=" focus:bg-destructive/70 cursor-pointer"
            >
              <Trash className="h-4 w-4" />
              Remove Application
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              copyToClipboard(
                window.location.href,
                "Job link copied to clipboard!",
              );
            }}
          >
            <Share2 className="h-4 w-4" />
            Share Job
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
