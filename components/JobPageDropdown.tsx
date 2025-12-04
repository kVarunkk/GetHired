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
import { Check, File, Forward, MoreHorizontal, Sparkle } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
import AskAIDialog from "./AskAIDialog";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { TApplicationStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const applicationStatuses = Object.values(TApplicationStatus);

export default function JobPageDropdown({
  user,
  jobId,
  isCompanyUser,
  aiCredits,
  isOnboardingComplete = false,
  applicationStatus,
  isPlatformJob,
}: {
  user: User | null;
  jobId: string;
  isCompanyUser: boolean;
  aiCredits?: number;
  isOnboardingComplete?: boolean;
  applicationStatus: TApplicationStatus | null;
  isPlatformJob: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [appStatus, setAppStatus] = useState(applicationStatus);
  const router = useRouter();

  const updateApplicationStatus = async (status: TApplicationStatus) => {
    try {
      if (!user || isCompanyUser || !appStatus || isPlatformJob) {
        return;
      }
      setAppStatus(status);

      const supabase = createClient();
      const { error } = await supabase
        .from("applications")
        .update({ status: status, updated_at: new Date().toISOString() })
        .eq("all_jobs_id", jobId)
        .eq("applicant_user_id", user.id);

      if (error) throw error;

      toast.success("Application status updated.");
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred.");
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild className="">
          <Button className="p-2" variant={"ghost"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!isCompanyUser &&
            (user ? (
              <DropdownMenuItem onClick={() => setIsOpen(true)}>
                <Sparkle className="h-4 w-4" />
                Ask AI
              </DropdownMenuItem>
            ) : (
              <Link href={"/auth/sign-up?returnTo=/jobs/" + jobId}>
                <DropdownMenuItem>
                  <Sparkle className="h-4 w-4" />
                  Ask AI
                </DropdownMenuItem>
              </Link>
            ))}
          {!isCompanyUser && user && appStatus && (
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
                        _ !== TApplicationStatus.REVIEWED
                    )
                    .map((status) => (
                      <DropdownMenuItem
                        key={status}
                        className="capitalize flex items-center justify-between"
                        onClick={() => updateApplicationStatus(status)}
                      >
                        {status}
                        {appStatus === status ? (
                          <Check className="h-4 w-4 " />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Job link copied to clipboard!");
            }}
          >
            <Forward className="h-4 w-4" />
            Share Job
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {user && !isCompanyUser && (
        <AskAIDialog
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          jobId={jobId}
          aiCredits={aiCredits}
          isOnboardingComplete={isOnboardingComplete}
        />
      )}
    </>
  );
}
