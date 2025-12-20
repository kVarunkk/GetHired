"use client";
import { Sheet, SheetTrigger } from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Bookmark, MoreHorizontal, Share2 } from "lucide-react";
import { User } from "@supabase/supabase-js";
import JobsPageCommonSheet from "./JobsPageCommonSheet";
import { copyToClipboard } from "@/lib/utils";
import { useState } from "react";

export default function JobsPageDropdown({ user }: { user: User | null }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild className="">
          <Button variant={"ghost"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <SheetTrigger className="w-full" asChild>
              <Button variant={"ghost"} onClick={() => setSheetOpen(true)}>
                <Bookmark className=" h-4 w-4" />
                View Bookmarks
              </Button>
            </SheetTrigger>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              copyToClipboard(
                window.location.href,
                "Job Search URL copied to clipboard!"
              );
            }}
          >
            <Share2 className="h-4 w-4" />
            Share Job Search
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {sheetOpen ? <JobsPageCommonSheet user={user} /> : ""}
    </Sheet>
  );
}
