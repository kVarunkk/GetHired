"use client";

import { useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Wraps a control the user's company role doesn't allow (TM-REQ-004), which the
 * caller renders disabled. A disabled button gets no pointer or focus events,
 * so the wrapper is what shows the reason on hover and keyboard focus. The
 * server still refuses the action.
 *
 * On touch, Radix opens the tooltip on focus and closes it on click, so a tap
 * only flashes it. A tap toggles it instead; tapping elsewhere closes it.
 */
export default function RoleLocked({
  reason,
  children,
}: {
  reason: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isTouch = useRef(false);
  const wasOpen = useRef(false);

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100} open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            // The disabled child would swallow the tap's click, so the span takes it.
            className="inline-flex min-w-0 max-w-full cursor-not-allowed rounded-md [&>*]:pointer-events-none"
            onPointerDown={(e) => {
              isTouch.current = e.pointerType !== "mouse";
              if (!isTouch.current) return;
              wasOpen.current = open;
              // Skips Radix's close-on-pointerdown.
              e.preventDefault();
            }}
            onClick={(e) => {
              if (!isTouch.current) return;
              // Skips Radix's close-on-click.
              e.preventDefault();
              setOpen(!wasOpen.current);
            }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
