"use client";

import { AuthButton } from "./auth-button";
import ProfileDropdown from "./ProfileDropdown";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Menu, Wallet } from "lucide-react";
import Brand from "./Brand";
import { cn, getNavItemsByPath } from "@/utils/utils";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import FeedbackForm from "./FeedbackForm";
import SocialsComponent from "./SocialsComponent";
import { DiscordLogoIcon } from "@radix-ui/react-icons";
import { usePathname } from "next/navigation";
import { INavItemWithActive } from "@/utils/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import WaitlistCTA from "./WaitlistCTA";
import ModifiedLink from "./ModifiedLink";

export default function NavbarComponent({
  variant = "vertical",
  initialUser,
}: {
  variant?: "vertical" | "horizontal";
  initialUser: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const isCompanyUser = user?.app_metadata?.type === "company";
  const navItems = useMemo(() => {
    // const isCompanyUser = user?.app_metadata?.type === "company";

    return getNavItemsByPath(pathname, isCompanyUser, user);
  }, [pathname, user, isCompanyUser]);

  const navbarItems = navItems.map((each) => {
    let isActive = false;

    if (each.type === "equals") {
      isActive = pathname === each.href;
    } else if (each.type === "startswith") {
      isActive = pathname === each.href || pathname.startsWith(each.href + "/");
    } else {
      isActive = pathname.includes(each.href);
    }

    return {
      ...each,
      active: isActive,
    };
  });

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      {/* horizontal */}
      <div
        className={cn(
          "w-full flex flex-col md:hidden",
          variant === "horizontal" && "md:flex",
        )}
      >
        <WaitlistCTA
          content={<p>Review your resume with our new AI Resume Checker</p>}
          redirectTo="/ai-resume-checker"
        />
        <div
          className={cn(
            "w-full flex items-center justify-between relative px-4 py-3 lg:px-20 xl:px-40 2xl:px-80 border-b mb-16 overflow-x-auto",
            // for mobile screens
            (pathname.startsWith("/jobs") ||
              pathname.startsWith("/companies") ||
              pathname.startsWith("/profiles") ||
              pathname.startsWith("/resume") ||
              pathname.startsWith("/company") ||
              pathname.startsWith("/dashboard")) &&
              "mb-0",
          )}
        >
          <div className="flex items-center gap-1 justify-start">
            {navbarItems ? <NavbarSheet items={navbarItems} /> : ""}
            <Link href={"/"}>
              <Brand type="long" />
            </Link>
          </div>

          {navbarItems && (
            <div className=" absolute left-1/2 -translate-x-1/2 items-center gap-4 text-sm hidden md:flex">
              {navbarItems.map((item) => (
                <ModifiedLink
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "hover:underline underline-offset-2",
                    item.active && "underline underline-offset-2",
                  )}
                >
                  {item.label}
                </ModifiedLink>
              ))}
            </div>
          )}

          <div className="justify-end">
            {user ? (
              <div className="flex items-center gap-5">
                <FeedbackForm user={user} isMenuOpen={false} />
                <ProfileDropdown user={user} isMenuOpen={false} />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  className="hover:text-primary p-2"
                  href={"https://discord.gg/6xvKBqW5eW"}
                  target="_blank"
                  aria-label="Join Community"
                  title="Join Community"
                >
                  <DiscordLogoIcon />
                </Link>
                <AuthButton isMenuOpen={true} variant={variant} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* vertical */}
      <div
        className={cn(
          "h-screen flex-col gap-3 p-4 border-r overflow-y-auto overflow-x-hidden sticky top-0 shrink-0 transition-all duration-300 ease-in-out",
          variant === "vertical" ? "hidden md:flex" : "hidden",
          isMenuOpen ? "w-52" : "w-20",
        )}
      >
        <Link href={"/"} className={cn(!isMenuOpen && "mx-auto")}>
          <Brand type={isMenuOpen ? "long" : "short"} />
        </Link>

        {navbarItems && (
          <div
            className={cn(
              "gap-4 text-sm flex flex-col mb-auto",
              isMenuOpen ? "items-start" : "items-center",
            )}
          >
            {navbarItems.map((item) => (
              <Tooltip key={item.id} delayDuration={100}>
                <TooltipTrigger asChild>
                  <ModifiedLink
                    href={item.href}
                    className={cn(
                      "hover:bg-secondary transition-all rounded-lg gap-2 items-center p-2 flex w-full truncate",
                      item.active && "bg-secondary",
                      isMenuOpen ? "justify-start" : "justify-center",
                    )}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {isMenuOpen && item.label}
                  </ModifiedLink>
                </TooltipTrigger>
                <TooltipContent side="right" hidden={isMenuOpen}>
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        <div className="justify-end flex flex-col gap-4">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={cn(
                  "flex p-2 items-center w-full gap-2 hover:bg-secondary transition-all rounded-lg truncate",
                  isMenuOpen ? "justify-start" : "justify-center",
                )}
              >
                {isMenuOpen ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {isMenuOpen && <span className="text-sm">Collapse</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" hidden={isMenuOpen}>
              <p>{isMenuOpen ? "Collapse" : "Expand"}</p>
            </TooltipContent>
          </Tooltip>

          {user ? (
            <div className="flex flex-col items-center gap-5">
              {!isCompanyUser && (
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <Link
                      href="/dashboard/buy-credits"
                      className={cn(
                        "text-brand flex p-2 items-center w-full gap-2 hover:bg-secondary transition-all rounded-lg truncate",
                        isMenuOpen ? "justify-start" : "justify-center",
                      )}
                    >
                      <Wallet className="h-4 w-4" />
                      {isMenuOpen && <span className="text-sm">Recharge</span>}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" hidden={isMenuOpen}>
                    <p>{isMenuOpen ? "" : "Recharge"}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <FeedbackForm
                isMenuOpen={isMenuOpen}
                user={user}
                isVertical={true}
              />
              <ProfileDropdown
                isMenuOpen={isMenuOpen}
                user={user}
                isVertical={true}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <Link
                    className={cn(
                      "hover:text-primary p-2 flex items-center gap-2 transition-all rounded-lg hover:bg-secondary w-full truncate",
                      isMenuOpen ? "justify-start" : "justify-center",
                    )}
                    href={"https://discord.gg/6xvKBqW5eW"}
                    target="_blank"
                    aria-label="Join Community"
                  >
                    <DiscordLogoIcon className="h-4 w-4" />
                    {isMenuOpen && (
                      <span className="text-sm">Join Community</span>
                    )}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" hidden={isMenuOpen}>
                  <p>Join Community</p>
                </TooltipContent>
              </Tooltip>
              <AuthButton isMenuOpen={isMenuOpen} variant={variant} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const NavbarSheet = ({ items }: { items: INavItemWithActive[] }) => {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button onClick={() => setOpen(true)} className="md:hidden p-2">
        <Menu />
      </button>
      <SheetContent
        side={"left"}
        className="overflow-y-auto flex flex-col gap-4 items-start"
      >
        <SheetHeader>
          <SheetTitle>
            <Link href={"/"}>
              <Brand type="long" />
            </Link>
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 items-start w-full">
          {items?.map((item) => {
            return (
              <ModifiedLink
                key={item.id}
                href={item.href}
                className={cn(
                  "hover:underline underline-offset-2 p-2 w-full",
                  item.active && "underline underline-offset-2",
                )}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </ModifiedLink>
            );
          })}
        </div>

        <SheetFooter className="mt-4">
          <SocialsComponent />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
