"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import ScrollMaskX from "@/components/ScrollMaskX";
import SidebarLabel from "@/components/SidebarLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/utils/utils";

export type EntityNavItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Active only on this exact path, not on the pages under it (the entity's index page). */
  exact?: boolean;
};

function isActive(pathname: string, item: EntityNavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The secondary sidebar of an id page (a job post, an application) or of a
 * main page with sections (settings): a back link to the list and the
 * entity's name (id pages only), then its sections, each its own page.
 * Styled like the agent's session sidebar. On desktop it collapses to a rail of
 * icons the way the main sidebar does (the width animates, labels fade, icons
 * stay put), with the Collapse toggle at the bottom. The state lives in the
 * entity's layout, so it holds across its sections. On phones it's a
 * scrolling row of links above the page instead.
 */
export default function EntityNav({
  label,
  title,
  backHref,
  backLabel,
  items,
}: {
  /** The nav's accessible name, e.g. "Job post sections". */
  label: string;
  /** The entity's name, under the back link. Main pages have none. */
  title?: ReactNode;
  /** Id pages only: main pages have no back link. */
  backHref?: string;
  backLabel?: string;
  items: EntityNavItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <>
      <aside
        id="entity-nav"
        className={cn(
          "hidden shrink-0 border-r bg-muted/30 transition-[width] duration-300 ease-in-out md:block",
          open ? "w-60" : "w-16",
        )}
      >
        <nav aria-label={label} className="sticky top-0 flex h-dvh flex-col gap-4 overflow-hidden p-2">
          {backHref && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Link
                  href={backHref}
                  className="flex shrink-0 items-center gap-2 overflow-hidden rounded-md px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" />
                  <SidebarLabel open={open}>{backLabel}</SidebarLabel>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" hidden={open}>
                <p>{backLabel}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* The title's height eases away with the width, so the items slide up instead of jumping. */}
          {title && (
            <div
              aria-hidden={!open}
              className={cn(
                "grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-in-out",
                // The gap above the title goes inside it, so it closes with the title.
                backHref && "-mt-4",
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <p className={cn("w-56 px-4 text-sm font-semibold [overflow-wrap:anywhere]", backHref && "mt-4")}>
                  {title}
                </p>
              </div>
            </div>
          )}
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
            {items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          // px-4 centres the 16px icon in the collapsed rail, so it never moves.
                          "flex items-center gap-2 overflow-hidden rounded-md px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
                          active && "bg-muted font-medium text-foreground",
                        )}
                      >
                        {item.icon}
                        <SidebarLabel open={open}>{item.label}</SidebarLabel>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" hidden={open}>
                      <p>{item.label}</p>
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={open ? "Collapse sections" : "Expand sections"}
                aria-controls="entity-nav"
                aria-expanded={open}
                onClick={() => setOpen((was) => !was)}
                className="flex shrink-0 items-center gap-2 overflow-hidden rounded-md px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                {/* One chevron that turns, as in the main sidebar. */}
                <ChevronRight
                  className={cn("h-4 w-4 shrink-0 transition-transform duration-300", open && "rotate-180")}
                />
                <SidebarLabel open={open}>Collapse</SidebarLabel>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" hidden={open}>
              <p>Expand</p>
            </TooltipContent>
          </Tooltip>
        </nav>
      </aside>

      <nav aria-label={label} className="flex flex-col gap-2 border-b px-4 pb-2 pt-3 md:hidden">
        {backHref && (
          <Link
            href={backHref}
            className="flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        )}
        <ScrollMaskX revealSelector='[aria-current="page"]'>
          <ul className="flex gap-1">
            {items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&_svg]:h-4 [&_svg]:w-4",
                      active && "bg-muted font-medium text-foreground",
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </ScrollMaskX>
      </nav>
    </>
  );
}
