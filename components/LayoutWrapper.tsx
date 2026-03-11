"use client";

import React, { useMemo } from "react";
import { cn, getNavbarVairantByPath, getNavItemsByPath } from "../utils/utils";
import { usePathname } from "next/navigation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { User } from "@supabase/supabase-js";
import NavbarComponent from "./Navbar";
import ScrollToTopButton from "./ScrollToTopButton";

interface LayoutWrapperProps {
  user: User | null;
  children: React.ReactNode;
}

const noScrollToTop = ["/resume-review/"];

export default function LayoutWrapper({ user, children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const variant = useMemo(() => {
    return getNavbarVairantByPath(pathname || "/");
  }, [pathname]);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isCompanyUser = user?.app_metadata?.type === "company";

  const navItems = useMemo(() => {
    return getNavItemsByPath(pathname || "/", isCompanyUser);
  }, [pathname, isCompanyUser]);

  return (
    <div
      className={cn(
        "flex min-h-screen  ",
        isDesktop && variant === "vertical" ? "flex-row" : "flex-col",
      )}
    >
      <NavbarComponent
        navItems={navItems}
        variant={variant}
        initialUser={user}
      />

      <div className="flex-1 w-full min-w-0 ">{children}</div>
      {!noScrollToTop.find((_) => pathname.startsWith(_)) && (
        <ScrollToTopButton />
      )}
    </div>
  );
}
