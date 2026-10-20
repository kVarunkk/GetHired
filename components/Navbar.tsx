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
import { ChevronRight, CreditCard, Menu, Wallet } from "lucide-react";
import Brand from "./Brand";
import { cn, fetcher, getNavItemsByPath, PROFILE_API_KEY } from "@/utils/utils";
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
import { COMPANY_HOME } from "@/helpers/user/home-path";
import SidebarLabel from "./SidebarLabel";
import ScrollFade from "./ScrollFade";
import { useOpenOutreachCount } from "./outreach/useOpenOutreachCount";
import useSWR from "swr";


/** The count next to a nav label (open outreach), hidden at 0. */
function NavCount({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} open`}
      className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full border border-brand/30 bg-brandSoft px-1.5 text-[11px] font-medium text-brandSoft-foreground"
    >
      {count}
    </span>
  );
}

export default function NavbarComponent({
  variant = "vertical",
  initialUser,
}: {
  variant?: "vertical" | "horizontal";
  initialUser: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  // Statically rendered pages (home, blog, job pages) are built without
  // cookies, so a null initialUser may just mean "unknown". Until the browser
  // reports the session, render neither signed-in nor signed-out controls, so
  // they don't swap after load.
  const [authResolved, setAuthResolved] = useState(initialUser !== null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const isCompanyUser = user?.app_metadata?.type === "company";
  // The landing page at / is for applicants; companies redirect from it anyway.
  const homeHref = isCompanyUser ? COMPANY_HOME : "/";
  // RP-REQ-016: Billing is hidden from company roles without billing.view.
  const { data: profile } = useSWR(user ? PROFILE_API_KEY : null, fetcher, { revalidateOnFocus: false });
  const showBilling = !isCompanyUser || profile?.profile?.access?.billingView !== false;
  const openOutreach = useOpenOutreachCount(user);
  const navItems = useMemo(() => {
    return getNavItemsByPath(pathname, isCompanyUser, user).map((item) =>
      item.id === "opportunities" ? { ...item, count: openOutreach } : item,
    );
  }, [pathname, user, isCompanyUser, openOutreach]);

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
      setAuthResolved(true);
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
        {/* Promo banner for the public site only; in-app (vertical) pages skip it. */}
        {variant === "horizontal" && (
          <WaitlistCTA
            content={
              <p>Use the brand new GetHired Agent to automate your Job Hunt.</p>
            }
            redirectTo="/agent"
          />
        )}
        <div
          className={cn(
            "w-full flex items-center justify-between gap-2 relative px-4 py-3 lg:px-20 xl:px-40 2xl:px-80 border-b mb-16",
            // for mobile screens
            (pathname.startsWith("/jobs") ||
              pathname.startsWith("/companies") ||
              pathname.startsWith("/profiles") ||
              pathname.startsWith("/resume") ||
              pathname.startsWith("/company") ||
              pathname.startsWith("/interview") ||
              pathname.startsWith("/agent") ||
              pathname.startsWith("/dashboard") ||
              pathname.startsWith("/opportunities") ||
              pathname.startsWith("/settings") ||
              pathname.startsWith("/get-started")) &&
              "mb-0",
          )}
        >
          <div className="flex min-w-0 items-center gap-1 justify-start">
            {authResolved ? (
              <NavbarSheet
                items={navbarItems}
                signedIn={user !== null}
                isCompanyUser={isCompanyUser}
                billingActive={pathname.startsWith("/company/billing")}
                showBilling={showBilling}
              />
            ) : (
              // Same 40px footprint as the menu button, so the logo doesn't shift.
              <LoadingNav className="lg:hidden p-2">
                <SkeletonBar className="h-6 w-6" />
              </LoadingNav>
            )}
            {/* The short logo on very small screens, so the bar fits without scrolling. */}
            <Link href={homeHref} aria-label="GetHired home" className="shrink-0">
              <span className="block min-[400px]:hidden">
                <Brand type="short" />
              </span>
              <span className="hidden min-[400px]:block">
                <Brand type="long" />
              </span>
            </Link>
          </div>

          {!authResolved ? (
            <LoadingNav className="absolute left-1/2 -translate-x-1/2 items-center gap-4 hidden lg:flex">
              {HORIZONTAL_SKELETON_WIDTHS.map((width, index) => (
                <SkeletonBar key={index} className={cn("h-4", width)} />
              ))}
            </LoadingNav>
          ) : (
            <nav
              aria-label="Main"
              className="absolute left-1/2 -translate-x-1/2 items-center gap-4 text-sm hidden lg:flex"
            >
              {/* Dashboard stays in the mobile menu, its only route on phones. */}
              {navbarItems
                .filter((item) => item.href !== "/dashboard")
                .map((item) => (
                  <ModifiedLink
                    key={item.id}
                    href={item.href}
                    className={cn(
                      "hover:underline underline-offset-2",
                      item.active && "underline underline-offset-2",
                    )}
                  >
                    {item.label}
                    <NavCount count={item.count} />
                  </ModifiedLink>
                ))}
            </nav>
          )}

          <div className="flex shrink-0 justify-end">
            {!authResolved ? (
              <div
                aria-hidden
                className="h-9 w-24 animate-pulse rounded-lg bg-muted"
              />
            ) : user ? (
              <div className="flex items-center gap-1">
                <FeedbackForm isMenuOpen={false} />
                <ProfileDropdown user={user} isMenuOpen={false} />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  // Hidden on very small phones to leave room for the auth buttons.
                  className="hover:text-primary p-2 max-[400px]:hidden"
                  href={"https://discord.gg/6xvKBqW5eW"}
                  target="_blank"
                  aria-label="Join Community"
                  title="Join Community"
                >
                  <DiscordLogoIcon />
                </Link>
                {/* This bar is horizontal even on sidebar pages (phones). */}
                <AuthButton isMenuOpen={true} variant="horizontal" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* vertical (desktop only; phones use the horizontal bar above) */}
      {variant === "vertical" && (
        <div
          className={cn(
            // Brand and the bottom controls stay put; only the items scroll.
            "h-screen flex-col gap-3 p-4 border-r overflow-hidden sticky top-0 shrink-0 transition-all duration-300 ease-in-out",
            "hidden md:flex",
            isMenuOpen ? "w-52" : "w-20",
          )}
        >
          {/* Always the long logo at the collapsed rail's width (48px tall), clipped
            by the sidebar: its left 48px is the short logo, so collapsing hides
            the wordmark without swapping images or moving the mark. */}
          <Link
            href={homeHref}
            aria-label="GetHired home"
            className="block w-full shrink-0 overflow-hidden"
          >
            <Brand type="long" className="h-12 w-[140px]" />
          </Link>

          <ScrollFade className="flex-1" contentClassName="py-1">
            {authResolved ? (
              <div className="gap-4 text-sm flex flex-col items-start">
                {navbarItems.map((item) => (
                  <Tooltip key={item.id} delayDuration={100}>
                    <TooltipTrigger asChild>
                      <ModifiedLink
                        href={item.href}
                        className={cn(
                          // px-4 centres the 16px icon in the collapsed rail, so it never moves.
                          "hover:bg-secondary transition-colors rounded-lg gap-2 items-center px-4 py-2 flex w-full overflow-hidden",
                          item.active && "bg-secondary",
                        )}
                      >
                        <span className="relative shrink-0">
                          {item.icon}
                          {!!item.count && !isMenuOpen && (
                            <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand" />
                          )}
                        </span>
                        <SidebarLabel open={isMenuOpen}>
                          {item.label}
                          <NavCount count={item.count} />
                        </SidebarLabel>
                      </ModifiedLink>
                    </TooltipTrigger>
                    <TooltipContent side="right" hidden={isMenuOpen}>
                      <p>{item.label}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <LoadingNav className="flex w-full flex-col gap-4">
                {Array.from({ length: SIDEBAR_SKELETON_ROWS }, (_, index) => (
                  // Same geometry as a real item: px-4 keeps the icon centred when collapsed.
                  <div
                    key={index}
                    className="flex items-center gap-2 px-4 py-2"
                  >
                    <SkeletonBar className="h-4 w-4 shrink-0" />
                    <SkeletonBar
                      className={cn(
                        "h-3.5 w-20 transition-opacity duration-300",
                        isMenuOpen ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </div>
                ))}
              </LoadingNav>
            )}
          </ScrollFade>

          <div className="shrink-0 justify-end flex flex-col gap-4">
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className={cn(
                    "flex px-4 py-2 items-center w-full gap-2 hover:bg-secondary transition-colors rounded-lg overflow-hidden",
                  )}
                >
                  {/* One chevron that turns, instead of swapping icons. */}
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-300",
                      isMenuOpen && "rotate-180",
                    )}
                  />
                  <SidebarLabel open={isMenuOpen}>Collapse</SidebarLabel>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" hidden={isMenuOpen}>
                <p>{isMenuOpen ? "Collapse" : "Expand"}</p>
              </TooltipContent>
            </Tooltip>

            {!authResolved ? (
              <div
                aria-hidden
                className="h-24 w-full animate-pulse rounded-lg bg-muted"
              />
            ) : user ? (
              <div className="flex flex-col items-center gap-5">
                {/* Applicants top up credits; companies manage their plan (billing.view). */}
                {showBilling && (
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Link
                        href={
                          isCompanyUser
                            ? "/company/billing"
                            : "/dashboard/buy-credits"
                        }
                        className={cn(
                          "text-brand flex px-4 py-2 items-center w-full gap-2 hover:bg-secondary transition-colors rounded-lg overflow-hidden",
                          isCompanyUser &&
                            pathname.startsWith("/company/billing") &&
                            "bg-secondary",
                        )}
                      >
                        {isCompanyUser ? (
                          <CreditCard className="h-4 w-4 shrink-0" />
                        ) : (
                          <Wallet className="h-4 w-4 shrink-0" />
                        )}
                        <SidebarLabel open={isMenuOpen}>
                          {isCompanyUser ? "Billing" : "Recharge"}
                        </SidebarLabel>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" hidden={isMenuOpen}>
                      <p>{isCompanyUser ? "Billing" : "Recharge"}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <FeedbackForm
                  isMenuOpen={isMenuOpen}
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
                        "hover:text-primary px-4 py-2 flex items-center gap-2 transition-colors rounded-lg hover:bg-secondary w-full overflow-hidden",
                      )}
                      href={"https://discord.gg/6xvKBqW5eW"}
                      target="_blank"
                      aria-label="Join Community"
                    >
                      <DiscordLogoIcon className="h-4 w-4 shrink-0" />
                      <SidebarLabel open={isMenuOpen}>
                        Join Community
                      </SidebarLabel>
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
      )}
    </>
  );
}

/** Placeholder widths for the desktop link row, roughly matching real labels. */
const HORIZONTAL_SKELETON_WIDTHS = [
  "w-10",
  "w-12",
  "w-16",
  "w-20",
  "w-16",
  "w-14",
];
const SIDEBAR_SKELETON_ROWS = 6;

/** A region that stands in for navigation while the session is unknown. */
function LoadingNav({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-label="Loading navigation"
      className={cn("animate-pulse", className)}
    >
      {children}
    </div>
  );
}

function SkeletonBar({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-muted", className)} />;
}

const NavbarSheet = ({
  items,
  signedIn,
  isCompanyUser,
  billingActive,
  showBilling = true,
}: {
  items: INavItemWithActive[];
  signedIn: boolean;
  isCompanyUser: boolean;
  billingActive: boolean;
  showBilling?: boolean;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="lg:hidden p-2"
      >
        <Menu />
      </button>
      <SheetContent
        side={"left"}
        className="overflow-y-auto flex flex-col gap-4 items-start"
      >
        <SheetHeader>
          <SheetTitle>
            <Link href={isCompanyUser ? COMPANY_HOME : "/"}>
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
                <NavCount count={item.count} />
              </ModifiedLink>
            );
          })}
          {/* Same as the sidebar: applicants top up credits; companies manage their plan. */}
          {signedIn && showBilling && (
            <Link
              href={isCompanyUser ? "/company/billing" : "/dashboard/buy-credits"}
              className={cn(
                "text-brand hover:underline underline-offset-2 p-2 w-full",
                isCompanyUser && billingActive && "underline underline-offset-2",
              )}
              onClick={() => setOpen(false)}
            >
              {isCompanyUser ? "Billing" : "Recharge"}
            </Link>
          )}
        </div>

        <SheetFooter className="mt-4">
          <SocialsComponent />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
