import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";

/** A dashboard block: a heading, an optional "View all"-style link, and its body. */
export default function DashboardSection({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {action && (
          <Button asChild variant="ghost" size="sm">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
