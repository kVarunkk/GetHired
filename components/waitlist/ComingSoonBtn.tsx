"use client";

import { Sparkle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";

export default function ComingSoonBtn({
  label,
  variant = "default",
}: {
  label: string;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | null
    | undefined;
}) {
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Link href={"/ai-resume-checker"}>
          <Button
            variant={variant}
            className="text-brand border-brand hover:text-brand"
          >
            <Sparkle className="h-4 w-4" />
            {label}
          </Button>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        Coming Soon.{" "}
        <Link className="text-blue-500" href={"/ai-resume-checker"}>
          Join the Waitlist.
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}
