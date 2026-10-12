"use client";

import { useTheme } from "next-themes";
import { Toaster, toast, resolveValue } from "react-hot-toast";
import { CheckCircle, XCircle, Loader2, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import PropagationStopper from "./StopPropagation";

export default function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  const themeStyles: React.CSSProperties = {
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    padding: "12px 16px",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: isDark
      ? "0 20px 25px -5px rgba(0, 0, 0, 0.5)"
      : "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: "300px",
    transition: "all 0.2s ease",
    maxWidth: "30%",
  };

  return (
    <Toaster
      key={resolvedTheme}
      position="top-center"
      gutter={12}
      containerStyle={{ top: 20 }}
    >
      {(t) => (
        <div
          style={{
            ...themeStyles,
            opacity: t.visible ? 1 : 0,
            transform: t.visible ? "translateY(0)" : "translateY(-20px)",
            borderLeft: `3px solid ${
              t.type === "success"
                ? "hsl(var(--success))"
                : t.type === "error"
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--muted-foreground))"
            }`,
          }}
          className="group relative"
        >
          <div className="shrink-0 ">
            {t.type === "loading" && (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            )}
            {t.type === "success" && (
              <CheckCircle className="w-4 h-4 text-success" />
            )}
            {t.type === "error" && (
              <XCircle className="w-4 h-4 text-destructive" />
            )}
          </div>

          <div className="flex-1 pr-2 min-w-0">
            {resolveValue(t.message, t)}
          </div>

          <PropagationStopper>
            <button
              onClick={() => {
                toast.dismiss(t.id);
              }}
              className="shrink-0 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </PropagationStopper>
        </div>
      )}
    </Toaster>
  );
}
