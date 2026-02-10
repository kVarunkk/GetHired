"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import React from "react";

interface WaitlistCTAProps {
  content: React.ReactNode;
  redirectTo: string;
  className?: string;
}
export default function WaitlistCTA({
  content,
  redirectTo,
  className,
}: WaitlistCTAProps) {
  return (
    <Link
      href={redirectTo}
      className={cn(
        "group inline-flex items-center justify-center gap-3 px-4 py-2  border transition-all ",
        // Background & Border: Using the soft brand tint with a slight transparency
        "bg-brandSoft border-brand/10 ",
        // Text Colors
        "text-brand-soft-foreground",
        // "shadow-sm hover:shadow-md ",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-brand text-brand-foreground animate-pulse shrink-0">
          <Sparkles size={12} fill="currentColor" />
        </div>
        <span className="text-sm font-semibold tracking-tight">{content}</span>
      </div>

      <ChevronRight
        size={14}
        className="transition-transform duration-300 group-hover:translate-x-1 opacity-60"
      />
    </Link>
  );
}
