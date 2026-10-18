"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/utils";

/**
 * A form's save bar that sticks to the bottom of the screen. While it's stuck
 * (the form goes on below it) it gets a top border and the content fades out
 * under it, like ScrollFade. Put it last in a `flex-col gap-6` form on a page
 * with `p-4`: it bleeds into that padding.
 */
export default function StickyActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const end = endRef.current;
    if (!end || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        data-stuck={stuck}
        className={cn(
          "sticky bottom-0 z-10 -mx-4 bg-background px-4 py-3 transition-colors duration-200",
          stuck ? "border-t" : "border-t border-transparent",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-background to-transparent transition-opacity duration-200",
            stuck ? "opacity-100" : "opacity-0",
          )}
        />
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>{children}</div>
      </div>
      {/* Off screen while the bar is stuck; -mt-6 cancels the parent's gap. */}
      <div ref={endRef} aria-hidden className="-mt-6 h-px" />
    </>
  );
}
