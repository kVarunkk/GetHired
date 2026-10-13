"use client";

import { Toaster, toast, resolveValue } from "react-hot-toast";
import { CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { cn } from "@/utils/utils";
import PropagationStopper from "./StopPropagation";

export default function ThemeAwareToaster() {
  return (
    <Toaster position="top-center" gutter={8} containerStyle={{ top: 16 }}>
      {(t) => (
        <div
          role={t.type === "error" ? "alert" : "status"}
          className={cn(
            "group flex w-[min(380px,calc(100vw-32px))] items-start gap-2.5 rounded-xl border bg-popover py-2.5 pl-3.5 pr-2 text-sm text-popover-foreground shadow-md transition-all duration-200 ease-out",
            t.visible
              ? "translate-y-0 opacity-100"
              : "-translate-y-2 opacity-0",
          )}
        >
          {t.type === "loading" && (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          {t.type === "success" && (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          )}
          {t.type === "error" && (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}

          <div className="min-w-0 flex-1 break-words leading-5">
            {resolveValue(t.message, t)}
          </div>

          {t.type !== "loading" && (
            <PropagationStopper>
              <button
                onClick={() => toast.dismiss(t.id)}
                className="-my-0.5 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </PropagationStopper>
          )}
        </div>
      )}
    </Toaster>
  );
}
