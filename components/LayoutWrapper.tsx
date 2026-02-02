"use client";

import React, { useMemo } from "react";
import { cn, getNavbarVairantByPath, getNavItemsByPath } from "../lib/utils";
import { usePathname } from "next/navigation";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { User } from "@supabase/supabase-js";
import NavbarComponent from "./Navbar";
import ScrollToTopButton from "./ScrollToTopButton";

interface LayoutWrapperProps {
  children: React.ReactNode;
  initialUser: User | null;
}

export default function LayoutWrapper({
  children,
  initialUser,
}: LayoutWrapperProps) {
  const pathname = usePathname();

  const variant = useMemo(() => {
    return getNavbarVairantByPath(pathname || "/");
  }, [pathname]);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isCompanyUser = useMemo(() => {
    if (initialUser) {
      return initialUser.app_metadata.type === "company";
    }
    return false;
  }, [initialUser]);

  const navItems = useMemo(() => {
    return getNavItemsByPath(pathname || "/", isCompanyUser);
  }, [pathname, isCompanyUser]);

  return (
    <div
      className={cn(
        "flex min-h-screen  ",
        isDesktop && variant === "vertical" ? "flex-row" : "flex-col"
      )}
    >
      <NavbarComponent
        navItems={navItems}
        variant={variant}
        initialUser={initialUser}
      />

      <div className="flex-1 w-full   ">{children}</div>
      <ScrollToTopButton />
    </div>
  );
}
