"use client";

import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

export default function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  const themeStyles = {
    background: isDark ? "#262626" : "#f5f5f5", // zinc-950 / white
    color: isDark ? "#f4f4f5" : "#18181b", // zinc-100 / zinc-900
    border: isDark ? "1px solid #27272a" : "1px solid #e4e4e7", // zinc-800 / zinc-200
    borderRadius: "12px",
    padding: "16px",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: isDark
      ? "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)"
      : "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  };

  return (
    <Toaster
      key={resolvedTheme}
      position="top-center"
      reverseOrder={false}
      gutter={12}
      toastOptions={{
        style: themeStyles,

        success: {
          duration: 4000,
          icon: <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />,
          style: {
            ...themeStyles,
            borderLeft: "2px solid #10b981", // Emerald-500
          },
        },

        error: {
          duration: 5000,
          icon: <XCircle className="w-5 h-5 text-red-500 shrink-0" />,
          style: {
            ...themeStyles,
            borderLeft: "2px solid #ef4444", // Red-500
          },
        },

        loading: {
          icon: (
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin shrink-0" />
          ),
          style: {
            ...themeStyles,
            borderLeft: "2px solid #6b7280", // Blue-500
          },
        },
      }}
    />
  );
}
