"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";

interface BrandProps {
  type: "long" | "short";
}

export default function Brand({ type }: BrandProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const imageUrls = {
    long: {
      light: "/logos/long-light.png",
      dark: "/logos/long-dark.png",
    },
    short: {
      dark: "/logos/short-dark.png",
      light: "/logos/short-light.png",
    },
  };

  if (!mounted || !resolvedTheme) {
    return (
      <div
        className={
          type === "long"
            ? "w-[100px] sm:w-[150px] h-[30px] sm:h-[40px] md:h-[50px]"
            : "w-[32px] sm:w-[40px] md:w-[50px] h-[32px] sm:h-[40px] md:h-[50px]"
        }
      />
    );
  }

  const src =
    resolvedTheme === "dark" ? imageUrls[type].dark : imageUrls[type].light;

  return (
    <div
      className={
        type === "long"
          ? "relative w-[100px] sm:w-[150px] h-[30px] sm:h-[40px] md:h-[50px]"
          : "relative w-[32px] sm:w-[40px] md:w-[50px] h-[32px] sm:h-[40px] md:h-[50px]"
      }
    >
      <img
        src={src}
        alt={`${type} brand logo`}
        className="w-full h-full object-contain"
        loading="eager"
      />
    </div>
  );
}
