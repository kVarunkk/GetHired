"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";

/** Copies `value` and shows a tick for a moment. */
export default function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  /** Accessible name, e.g. "Copy server URL". */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn("h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
