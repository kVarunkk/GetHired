"use client";

import * as React from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

// A Popover from `sm` up and a bottom Drawer below it, like AddToListMenu: on
// a phone a field in it brings up the keyboard, which a bottom sheet copes
// with and an anchored popover doesn't.
//
// The breakpoint matches ResponsiveDialog's.
const DESKTOP_QUERY = "(min-width: 640px)";

export function ResponsivePopover({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  showTitleOnDesktop = false,
  align = "end",
  className,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens it. */
  trigger: React.ReactElement;
  /** The drawer's heading on a phone. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Also render the title at the top of the popover. */
  showTitleOnDesktop?: boolean;
  align?: "start" | "center" | "end";
  /** Styles the popover, and the drawer's body. */
  className?: string;
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [openState, setOpenState] = React.useState(false);
  const isOpen = open ?? openState;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  if (isDesktop) {
    return (
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align={align} className={className}>
          {showTitleOnDesktop && <p className="text-sm font-semibold">{title}</p>}
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base">{title}</DrawerTitle>
          <DrawerDescription className={cn(!description && "sr-only")}>
            {description ?? title}
          </DrawerDescription>
        </DrawerHeader>
        <div
          className={cn(
            className,
            "w-full overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          )}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
