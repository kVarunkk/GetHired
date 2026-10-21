"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { LogIn, UserLock } from "lucide-react";
import { cn } from "@/utils/utils";
import SidebarLabel from "./SidebarLabel";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Centred content that never wraps while the sidebar width animates: the
// label fades on one line and its width (and the gap before it) grows from
// zero, so the icon is centred in the collapsed rail too.
const sidebarButton = "w-full gap-0 overflow-hidden";

function ButtonLabel({ open, children }: { open: boolean; children: string }) {
  return (
    <span
      className={cn(
        "overflow-hidden transition-[max-width,margin] duration-300 ease-in-out",
        open ? "ml-2 max-w-24" : "ml-0 max-w-0",
      )}
    >
      <SidebarLabel open={open}>{children}</SidebarLabel>
    </span>
  );
}

export function AuthButton({
  isMenuOpen,
  variant = "vertical",
}: {
  isMenuOpen: boolean;
  variant?: "horizontal" | "vertical";
}) {
  // The layout comes from where the buttons are, never from measuring the
  // screen, so the first render is already right (no reflow after hydration).
  // "vertical" is the desktop sidebar; the top bar always passes "horizontal".
  return (
    <div
      className={cn(
        "flex w-full",
        variant === "horizontal" ? "gap-2" : "flex-col gap-4",
      )}
    >
      {variant === "vertical" ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="sm"
              variant={"outline"}
              className={cn(sidebarButton)}
            >
              <Link href="/auth/login" aria-label="Sign in">
                <LogIn className="h-4 w-4" />
                <ButtonLabel open={isMenuOpen}>Sign in</ButtonLabel>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Sign in</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button asChild size="sm" variant={"outline"}>
          <Link href="/auth/login">{isMenuOpen ? "Sign in" : ""}</Link>
        </Button>
      )}

      {variant === "vertical" ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="sm"
              variant={"default"}
              className={cn(sidebarButton)}
            >
              <Link href="/auth/sign-up" aria-label="Sign up">
                <UserLock className="h-4 w-4" />
                <ButtonLabel open={isMenuOpen}>Sign up</ButtonLabel>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Sign up</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        // Only Sign in on very small phones, so the bar fits; the login page
        // links to sign up.
        <Button asChild size="sm" variant={"default"} className="max-[400px]:hidden">
          <Link href="/auth/sign-up">{isMenuOpen ? "Sign up" : ""}</Link>
        </Button>
      )}
    </div>
  );
}
