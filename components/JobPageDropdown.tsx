"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "./ui/button";
import { Forward, MoreHorizontal, Sparkle } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
import AskAIDialog from "./AskAIDialog";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
export default function JobPageDropdown({
  user,
  jobId,
  isCompanyUser,
  aiCredits,
  isOnboardingComplete = false,
}: {
  user: User | null;
  jobId: string;
  isCompanyUser: boolean;
  aiCredits?: number;
  isOnboardingComplete?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild className="">
          <Button className="p-2" variant={"ghost"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Job link copied to clipboard!");
            }}
          >
            <Forward className="h-4 w-4" />
            Share Job
          </DropdownMenuItem>
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
