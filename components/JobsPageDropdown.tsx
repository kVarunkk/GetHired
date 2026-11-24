"use client";
import Link from "next/link";
import { User } from "@supabase/supabase-js";
import { Bell, MoreHorizontal, Share2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { copyToClipboard } from "@/utils/utils";
import { JOB_ALERTS_SETTINGS_PATH } from "@/helpers/job-alerts/paths";

export default function JobsPageDropdown({ user }: { user: User | null }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant={"ghost"} aria-label="More">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {user && (
          <DropdownMenuItem asChild>
            <Link href={JOB_ALERTS_SETTINGS_PATH}>
              <Bell className="h-4 w-4" />
              Manage job alerts
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onClick={() => {
            copyToClipboard(
              window.location.href,
              "Job Search URL copied to clipboard!",
            );
          }}
        >
          <Share2 className="h-4 w-4" />
          Share Job Search
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
