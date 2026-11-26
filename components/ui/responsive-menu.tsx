"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";
import {
  Drawer,
  DrawerContent,
  DrawerBandHeader,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

// An actions menu: a DropdownMenu from `sm` up and a bottom Drawer of actions
// below it. On a phone the actions are full-width rows in thumb reach, and a
// submenu (ResponsiveMenuSub) becomes a labelled group in the same drawer.
//
// The breakpoint matches ResponsiveDialog's.
const DESKTOP_QUERY = "(min-width: 640px)";

const IsDesktopContext = React.createContext(true);
// Closes the drawer once an action runs.
const CloseContext = React.createContext<() => void>(() => {});

function ResponsiveMenu({
  trigger,
  title,
  description,
  align = "end",
  children,
}: {
  /** The button that opens the menu. */
  trigger: React.ReactElement;
  /** The drawer's heading on a phone, e.g. the item's name. */
  title: string;
  description?: string;
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = React.useState(false);

  if (isDesktop) {
    return (
      <IsDesktopContext.Provider value={true}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align={align}>{children}</DropdownMenuContent>
        </DropdownMenu>
      </IsDesktopContext.Provider>
    );
  }

  return (
    <IsDesktopContext.Provider value={false}>
      <CloseContext.Provider value={() => setOpen(false)}>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          <DrawerContent className="max-h-[85dvh]">
            <DrawerBandHeader>
              <DrawerTitle className="truncate text-base">{title}</DrawerTitle>
              <DrawerDescription className={cn("truncate", !description && "sr-only")}>
                {description ?? "Actions"}
              </DrawerDescription>
            </DrawerBandHeader>
            <div
              role="menu"
              aria-label={title}
              className="flex min-h-0 flex-col overflow-y-auto px-2 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {children}
            </div>
          </DrawerContent>
        </Drawer>
      </CloseContext.Provider>
    </IsDesktopContext.Provider>
  );
}

function ResponsiveMenuItem({
  asChild = false,
  destructive = false,
  className,
  onClick,
  children,
}: {
  asChild?: boolean;
  destructive?: boolean;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const close = React.useContext(CloseContext);

  if (React.useContext(IsDesktopContext)) {
    return (
      <DropdownMenuItem
        asChild={asChild}
        onClick={onClick}
        className={cn(destructive && "text-destructive focus:text-destructive", className)}
      >
        {children}
      </DropdownMenuItem>
    );
  }

  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      role="menuitem"
      {...(asChild ? {} : { type: "button" as const })}
      onClick={() => {
        close();
        onClick?.();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
        destructive && "text-destructive",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

function ResponsiveMenuSeparator() {
  if (React.useContext(IsDesktopContext)) return <DropdownMenuSeparator />;
  return <div role="separator" className="-mx-2 my-1 h-px bg-border" />;
}

/** A submenu on desktop; a labelled group of rows on a phone. */
function ResponsiveMenuSub({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  if (React.useContext(IsDesktopContext)) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>{children}</DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    );
  }
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <p id={id} className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

export { ResponsiveMenu, ResponsiveMenuItem, ResponsiveMenuSeparator, ResponsiveMenuSub };
