"use client";

import React, { useMemo } from "react";
import {
  cn,
  fullHeightPaths,
  getNavbarVairantByPath,
  noScrollToTop,
} from "../utils/utils";
import { usePathname } from "next/navigation";
import { User } from "@supabase/supabase-js";
import NavbarComponent from "./Navbar";
import ScrollToTopButton from "./ScrollToTopButton";

interface LayoutWrapperProps {
  user: User | null;
  children: React.ReactNode;
}

export default function LayoutWrapper({ user, children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const variant = useMemo(() => {
    return getNavbarVairantByPath(pathname || "/");
  }, [pathname]);
  const isFullHeight = fullHeightPaths.some((p) => pathname.startsWith(p));

  return (
    <div
      className={cn(
        // Full-height pages get exactly the viewport, and the page fills
        // whatever the navbar leaves, so nothing has to guess its height.
        isFullHeight ? "flex h-dvh" : "flex min-h-screen",
        variant === "vertical" ? "flex-col md:flex-row" : "flex-col",
      )}
    >
      <NavbarComponent variant={variant} initialUser={user} />

      <div
        className={cn(
          "flex-1 w-full min-w-0",
          isFullHeight && "flex min-h-0 flex-col",
        )}
      >
        {children}
      </div>
      {!noScrollToTop.find((_) => pathname.startsWith(_)) && (
        <ScrollToTopButton />
      )}
    </div>
  );
}
