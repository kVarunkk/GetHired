"use client";

import * as React from "react";

import ScrollFade from "@/components/ScrollFade";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";

// A Dialog from `sm` up and a bottom Drawer below it, with the same parts.
// On a phone a bottom sheet is in thumb reach, swipes away, and copes with the
// on-screen keyboard. Use it for forms and content; confirmations stay
// AlertDialogs.
//
// The breakpoint matches DialogContent's own `sm:` styles, so `sm:` classes
// passed to a part only ever apply to the dialog.
const DESKTOP_QUERY = "(min-width: 640px)";

const IsDesktopContext = React.createContext(true);

function ResponsiveDialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const rootProps = { open, defaultOpen, onOpenChange, children };

  return (
    <IsDesktopContext.Provider value={isDesktop}>
      {isDesktop ? <Dialog {...rootProps} /> : <Drawer {...rootProps} />}
    </IsDesktopContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogTrigger>,
) {
  const Trigger = React.useContext(IsDesktopContext)
    ? DialogTrigger
    : DrawerTrigger;
  return <Trigger {...props} />;
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogClose>,
) {
  const Close = React.useContext(IsDesktopContext) ? DialogClose : DrawerClose;
  return <Close {...props} />;
}

// Both layouts are a column: ResponsiveDialogHeader and ResponsiveDialogFooter
// stay put and ResponsiveDialogBody scrolls between them, so the main action
// is always on screen. A form that holds both the body and the footer needs
// `flex min-h-0 flex-col gap-4` so the body can still shrink inside it.
//
// `className` styles the dialog only. `drawerClassName` styles the drawer's
// column (e.g. a fixed height for a layout that scrolls its own panes).
function ResponsiveDialogContent({
  className,
  drawerClassName,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogContent> & {
  drawerClassName?: string;
}) {
  if (React.useContext(IsDesktopContext)) {
    return (
      <DialogContent
        className={cn("flex max-h-[90dvh] flex-col", className)}
        {...props}
      >
        {children}
      </DialogContent>
    );
  }

  // The column is capped at the drawer's height minus its 1.5rem handle. It
  // only scrolls itself when a drawer has no ResponsiveDialogBody.
  return (
    <DrawerContent className="max-h-[92dvh]" {...props}>
      <div
        className={cn(
          "flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 scrollbar-none",
          drawerClassName,
        )}
      >
        {children}
      </div>
    </DrawerContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  if (React.useContext(IsDesktopContext)) {
    return <DialogHeader className={className} {...props} />;
  }

  // The same secondary band as DialogHeader. The negative margins cancel the
  // drawer column's px-4.
  return (
    <div
      className={cn(
        "-mx-4 flex shrink-0 flex-col space-y-1.5 border-y bg-secondary px-4 py-3 text-left",
        className,
      )}
      {...props}
    />
  );
}

// The scrolling middle. No scrollbar, like the sidebar: a fade shows there's
// more. It sizes to its content and shrinks once the dialog hits its height
// cap. The negative margins run it edge to edge so focus rings and the fades
// aren't clipped; `className` styles the wrapper around the children. The
// top margin also cancels the column's gap-4, so content scrolls right up to
// the header's band instead of being cut off a gap below it. The header's
// border-b already marks that edge, so the top fade drops its own hairline.
function ResponsiveDialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const isDesktop = React.useContext(IsDesktopContext);
  return (
    <ScrollFade
      className={cn(
        "-mb-1 -mt-4 flex flex-col [&>[data-edge=top]]:border-t-0",
        isDesktop ? "-mx-6" : "-mx-4",
      )}
      scrollerClassName="h-auto min-h-0"
      contentClassName={cn(
        "pb-1 pt-4",
        isDesktop ? "px-6" : "px-4",
        className,
      )}
    >
      {children}
    </ScrollFade>
  );
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  if (React.useContext(IsDesktopContext)) {
    return (
      <DialogFooter className={cn("mt-auto shrink-0", className)} {...props} />
    );
  }

  return (
    <div
      className={cn("mt-auto flex shrink-0 flex-col-reverse gap-2", className)}
      {...props}
    />
  );
}

function ResponsiveDialogTitle(
  props: React.ComponentPropsWithoutRef<typeof DialogTitle>,
) {
  const Title = React.useContext(IsDesktopContext) ? DialogTitle : DrawerTitle;
  return <Title {...props} />;
}

function ResponsiveDialogDescription(
  props: React.ComponentPropsWithoutRef<typeof DialogDescription>,
) {
  const Description = React.useContext(IsDesktopContext)
    ? DialogDescription
    : DrawerDescription;
  return <Description {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
};
