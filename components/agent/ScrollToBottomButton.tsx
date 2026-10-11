"use client";

import { ArrowDown } from "lucide-react";
import { cn } from "@/utils/utils";

/**
 * Jumps the conversation to the newest message. Styled like the app's
 * ScrollToTopButton, but positioned inside the chat (which scrolls its own
 * panel, not the window). Stays mounted so it can fade; hidden means inert.
 */
export default function ScrollToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Scroll to latest message"
      aria-hidden={!visible}
      inert={!visible}
      onClick={onClick}
      className={cn(
        "absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-secondary p-2.5 text-secondary-foreground shadow-lg transition-opacity duration-300",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
}
