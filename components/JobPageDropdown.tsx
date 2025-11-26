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
export default function JobPageDropdown() {
  return (
    <DropdownMenu>
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
        {/* <DropdownMenuItem disabled>
          <Sparkle className="h-4 w-4" />
          Summarize using AI (Coming Soon)
        </DropdownMenuItem> */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
