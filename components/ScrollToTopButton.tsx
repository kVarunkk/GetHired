"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/utils/utils"; // Or use your own classnames utility

export default function ScrollToTopButton({
  showAfter = 300, // px to scroll before showing button
  className = "",
}: {
  showAfter?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > showAfter);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [showAfter]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={scrollToTop}
      className={cn(
        // Lifted above a StickyActionBar when the page has one.
        "fixed bottom-[calc(2.5rem+var(--sticky-action-bar-height,0px))] right-10 sm:right-20 z-50 bg-secondary text-secondary-foreground rounded-full p-3 shadow-lg transition-opacity duration-300 border border-border",
        visible
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none",
        className,
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}
