"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { LogIn, UserLock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

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
      <Button
        asChild
        size="sm"
        variant={"outline"}
        className={cn(variant === "vertical" && "w-full")}
      >
        <Link href="/auth/login">
          {variant === "vertical" && isDesktop && <LogIn className="h-4 w-4" />}
          {isMenuOpen ? "Sign in" : ""}
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        variant={"default"}
        className={cn(variant === "vertical" && "w-full")}
      >
        <Link href="/auth/sign-up">
          {variant === "vertical" && isDesktop && (
            <UserLock className="h-4 w-4" />
          )}
          {isMenuOpen ? "Sign up" : ""}
        </Link>
      </Button>
    </div>
  );
}
