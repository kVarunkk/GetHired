import * as React from "react";

import { cn } from "@/utils/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base leading-6 transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:outline-none focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-foreground/5 aria-[invalid=true]:border-destructive/60 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
