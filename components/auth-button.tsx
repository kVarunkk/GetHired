"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { LogIn, UserLock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AuthButton({
  isMenuOpen,
  variant = "vertical",
}: {
  isMenuOpen: boolean;
  variant?: "horizontal" | "vertical";
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  return (
    <div
      className={cn(
        "flex  gap-4 w-full",
        variant === "horizontal" || !isDesktop ? " gap-2" : "flex-col"
      )}
    >
      {variant === "vertical" ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="sm"
              variant={"outline"}
              className={cn("w-full")}
            >
              <Link href="/auth/login">
                {isDesktop && <LogIn className="h-4 w-4" />}
                {isMenuOpen ? "Sign in" : ""}
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
              className={cn("w-full")}
            >
              <Link href="/auth/sign-up">
                {isDesktop && <UserLock className="h-4 w-4" />}
                {isMenuOpen ? "Sign up" : ""}
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Sign up</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button asChild size="sm" variant={"default"}>
          <Link href="/auth/sign-up">{isMenuOpen ? "Sign up" : ""}</Link>
        </Button>
      )}
    </div>
  );
}
