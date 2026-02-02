"use client";

import { AuthButton } from "./auth-button";
import ProfileDropdown from "./ProfileDropdown";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import Brand from "./Brand";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import FeedbackForm from "./FeedbackForm";
import SocialsComponent from "./SocialsComponent";
import { DiscordLogoIcon } from "@radix-ui/react-icons";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { usePathname } from "next/navigation";
import { INavItem, INavItemWithActive } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import WaitlistCTA from "./WaitlistCTA";
import ModifiedLink from "./ModifiedLink";

export default function NavbarComponent({
  navItems,
  variant = "vertical",
  initialUser,
}: {
  navItems: INavItem[];
  variant?: "vertical" | "horizontal";
  initialUser: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [isMounted, setIsMounted] = useState(false);
  const [navbarItems, setNavbarItems] = useState<INavItemWithActive[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    if (navItems.length > 0 && pathname) {
      setNavbarItems(() => {
        return navItems.map((each) => {
          let isActive = false;

          if (each.type === "equals") {
            isActive = pathname === each.href;
          } else if (each.type === "startswith") {
            isActive =
              pathname === each.href || pathname.startsWith(each.href + "/");
          } else {
            isActive = pathname.includes(each.href);
          }

          return {
            ...each,
            active: isActive,
          };
        });
      });
    }
  }, [navItems, pathname]);

  useEffect(() => {
    setIsMounted(true);
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

  if (!isMounted) return "";

  if (variant === "horizontal" || !isDesktop) {
    return (
      <div className="flex flex-col ">
        <WaitlistCTA
          content={<p>Join the Waitlist for the new AI Resume Checker</p>}
          redirectTo="/ai-resume-checker"
        />
        <div
          className={cn(
            "w-full flex items-center justify-between relative px-4 py-3 lg:px-20 xl:px-40 2xl:px-80 border-b mb-16",
            (pathname.startsWith("/jobs") ||
              pathname.startsWith("/companies") ||
              pathname.startsWith("/profiles") ||
              pathname.startsWith("/resume")) &&
              "mb-0"
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
                    item.active && "underline underline-offset-2"
                  )}
                >
                  {item.label}
                </ModifiedLink>
              ))}
            </div>
          )}
          <div className="justify-end">
            {user && (
              <div className="flex items-center gap-5">
                <FeedbackForm user={user} isMenuOpen={false} />
                <ProfileDropdown user={user} isMenuOpen={false} />
              </div>
            )}
            {user === null && (
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
    );
  }

  if (variant === "vertical") {
    return (
      <div
        className={cn(
          "h-screen flex flex-col gap-3 p-4 border-r overflow-y-scroll sticky transition-all duration-300 ease-in-out top-0",
          isMenuOpen ? "w-60" : "w-20"
        )}
      >
        <div className="flex items-center gap-1 justify-start">
          {navbarItems ? <NavbarSheet items={navbarItems} /> : ""}
          <Link href={"/"}>
            <Brand type={isMenuOpen ? "long" : "short"} />
          </Link>
        </div>
        {navbarItems && (
          <div
            className={cn(
              "  gap-4 text-sm hidden md:flex md:flex-col  mb-auto",
              isMenuOpen ? "items-start" : "items-center"
            )}
          >
            {navbarItems.map((item) => (
              <Tooltip key={item.id} delayDuration={100}>
                <TooltipTrigger asChild>
                  <ModifiedLink
                    key={item.id}
                    href={item.href}
                    className={cn(
                      "hover:bg-secondary transition-all rounded-lg  gap-2 items-center  p-2 flex w-full",
                      item.active && "bg-secondary",
                      isMenuOpen ? "justify-start" : "justify-center"
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
                  "hidden md:flex p-2  items-center w-full gap-2 hover:bg-secondary transition-all rounded-lg",
                  isMenuOpen ? "justify-start" : "justify-center"
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
              <p>{isMenuOpen ? "Collapse " : "Expand "}</p>
            </TooltipContent>
          </Tooltip>
          {user && (
            <div className="flex md:flex-col items-center gap-5">
              <FeedbackForm isMenuOpen={isMenuOpen} user={user} />
              <ProfileDropdown isMenuOpen={isMenuOpen} user={user} />
            </div>
          )}
          {user === null && (
            <div className="flex md:flex-col items-center gap-4">
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <Link
                    className={cn(
                      "hover:text-primary p-2 flex items-center gap-2 transition-all rounded-lg hover:bg-secondary w-full",
                      isMenuOpen ? "justify-start" : "justify-center"
                    )}
                    href={"https://discord.gg/6xvKBqW5eW"}
                    target="_blank"
                    aria-label="Join Community"
                    // title="Join Community"
                  >
                    <DiscordLogoIcon className="h-4 w-4" />
                    {isMenuOpen ? (
                      <span className="text-sm">Join Community</span>
                    ) : (
                      ""
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
    );
  }
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

        {items ? (
          <div className="flex flex-col gap-4 items-start w-full">
            {items.map((item) => (
              <ModifiedLink
                key={item.id}
                href={item.href}
                className={cn(
                  "hover:underline underline-offset-2 p-2 w-full",
                  item.active && "underline underline-offset-2"
                )}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </ModifiedLink>
            ))}
          </div>
        ) : (
          ""
        )}
        <SheetFooter className="mt-4">
          <SocialsComponent />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
