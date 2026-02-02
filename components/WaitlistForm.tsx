"use client";

import { joinWaitlistAction } from "@/app/actions/add-to-waitlist";
import { cn } from "@/lib/utils";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";
import { TWaitlistType } from "@/lib/types";

interface WaitlistFormProps {
  type: TWaitlistType;
  className?: string;
  variant?: "hero" | "compact";
}

/**
 * WaitlistForm Component
 * A reusable lead capture component with built-in spam protection and success states.
 * Updated to fix module resolution errors in the build environment.
 */
export default function WaitlistForm({
  type,
  className,
  variant = "hero",
}: WaitlistFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isJoined, setIsJoined] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    // Explicitly add the source for tracking lead generation origin
    formData.append("type", type);

    try {
      const result = await joinWaitlistAction(formData);

      if (result.error) {
        toast.error(result.error);
        setIsLoading(false);
      } else {
        toast.success(result.message || "Successfully joined!");
        setIsJoined(true);
        setIsLoading(false);
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (isJoined) {
    return (
      <div
        className={cn(
          "p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 animate-in zoom-in duration-300",
          className
        )}
      >
        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 text-center">
          🎉 You`&apos;re on the list! We`&apos;ll notify you soon.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex flex-col sm:flex-row items-center gap-3 p-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl focus-within:ring-2 focus-within:ring-brand/20 transition-all",
        variant === "compact" ? "max-w-sm" : "max-w-md w-full",
        className
      )}
    >
      {/* Honeypot Field for Bot Protection */}
      <input
        type="text"
        name="full_name"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
      />

      <input
        type="email"
        name="email"
        required
        placeholder="Enter your email"
        className="flex-1 w-full bg-transparent border-none focus:ring-0 px-4 py-3 text-sm placeholder:text-zinc-400 outline-none"
      />
      <Button
        type="submit"
        disabled={isLoading}
        className="w-full sm:w-auto bg-brand hover:bg-brand/70 text-brand-foreground font-bold h-11 px-8 rounded-xl shadow-lg shadow-brand/20 transition-all active:scale-95 disabled:opacity-70"
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Joining...</span>
          </div>
        ) : (
          "Join Waitlist"
        )}
      </Button>
    </form>
  );
}
