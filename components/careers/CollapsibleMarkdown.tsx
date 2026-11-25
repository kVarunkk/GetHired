"use client";

import { useId, useState } from "react";
import { cn } from "@/utils/utils";
import { SafeMarkdown } from "./CareersSections";

/** Long enough to be worth folding: by length, or by the number of lines it takes. */
const LONG_CHARS = 600;
const LONG_LINES = 8;

export const isLongText = (text: string) => text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;

/** Markdown that folds behind "Show more" when it's long, so it doesn't push the open roles down. */
export default function CollapsibleMarkdown({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!isLongText(children)) return <SafeMarkdown>{children}</SafeMarkdown>;
  return (
    <div className="flex flex-col items-start gap-2">
      <div
        id={id}
        className={cn("relative w-full", !open && "max-h-52 overflow-hidden")}
      >
        <SafeMarkdown>{children}</SafeMarkdown>
        {!open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-[var(--careers-accent)] hover:underline"
      >
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
