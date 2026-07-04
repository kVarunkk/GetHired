"use client";

import React, { useMemo } from "react";
import { cn, getNavbarVairantByPath, noScrollToTop } from "../utils/utils";
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

  return (
    <div
      className={cn(
        "flex min-h-screen  ",
        variant === "vertical" ? "flex-col md:flex-row" : "flex-col",
      )}
    >
      <NavbarComponent variant={variant} initialUser={user} />

      <div className="flex-1 w-full min-w-0 ">{children}</div>
      {!noScrollToTop.find((_) => pathname.startsWith(_)) && (
        <ScrollToTopButton />
      )}
    </div>
  );
}
