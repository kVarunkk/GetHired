import Link from "next/link";
import { Building2, GraduationCap } from "lucide-react";
import ScrollMaskX from "@/components/ScrollMaskX";
import { cn } from "@/utils/utils";

export type InterviewsTab = "mock" | "companies";

const TABS: Record<
  InterviewsTab,
  { label: string; href: string; icon: typeof Building2 }
> = {
  mock: { label: "Mock interviews", href: "/interview", icon: GraduationCap },
  companies: {
    label: "From companies",
    href: "/interview?tab=companies",
    icon: Building2,
  },
};

/**
 * The Interviews page's tabs as links (`?tab=companies`), so each tab has its
 * own URL and the back button works. Looks like the shadcn `Tabs`. On a
 * narrow screen the row scrolls sideways and fades at the edges (ScrollMaskX).
 */
export default function InterviewTabs({
  active,
  counts,
}: {
  active: InterviewsTab;
  counts: Record<InterviewsTab, number>;
}) {
  return (
    <ScrollMaskX className="self-start" revealSelector='[aria-current="page"]'>
      <nav
        aria-label="Interview types"
        className="inline-flex h-9 w-max items-center rounded-lg bg-muted p-1 text-muted-foreground"
      >
        {(Object.keys(TABS) as InterviewsTab[]).map((tab) => {
          const { label, href, icon: Icon } = TABS[tab];
          const isActive = tab === active;
          return (
            <Link
              key={tab}
              href={href}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "bg-background text-foreground shadow"
                  : "hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              <span className="tabular-nums text-muted-foreground">
                {counts[tab]}
              </span>
            </Link>
          );
        })}
      </nav>
    </ScrollMaskX>
  );
}
