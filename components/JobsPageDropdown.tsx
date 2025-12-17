"use client";
import { Sheet, SheetTrigger } from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Bookmark, MoreHorizontal, Share } from "lucide-react";
import { User } from "@supabase/supabase-js";
import JobsPageCommonSheet from "./JobsPageCommonSheet";
import toast from "react-hot-toast";

export default function JobsPageDropdown({ user }: { user: User | null }) {
  return (
    <Sheet>
      <DropdownMenu>
        <DropdownMenuTrigger asChild className="">
          <Button variant={"ghost"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <SheetTrigger className="w-full" asChild>
              <Button variant={"ghost"}>
                <Bookmark className=" h-4 w-4" />
                View Bookmarks
              </Button>
            </SheetTrigger>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Job Search URL copied to clipboard!");
            }}
          >
            <Share className="h-4 w-4" />
            Share Job Search
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <JobsPageCommonSheet user={user} />
    </Sheet>
  );
}
