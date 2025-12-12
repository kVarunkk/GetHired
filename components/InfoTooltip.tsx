"use client";

import * as React from "react"; // Explicitly import React
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"; // Import Popover components
import { Info } from "lucide-react";

interface InfoTooltipProps {
  content: React.ReactNode;
}

export default function InfoTooltip({ content }: InfoTooltipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label="More information"
          className="cursor-pointer inline-flex items-center justify-center 
                     rounded-full transition-colors 
                     hover:text-primary focus-visible:ring-2 focus-visible:ring-offset-2 p-2"
        >
          <Info className="h-3 w-3 text-muted-foreground" />
        </span>
      </PopoverTrigger>

      <PopoverContent
        className=" w-fit max-w-60 text-sm p-3 z-50 shadow-lg bg-popover text-popover-foreground"
        align="start"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
