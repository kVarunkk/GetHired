import type { ReactNode } from "react";
import { BackLink } from "@/components/PageHeader";

/**
 * The heading row of a section page inside an `EntityLayout`, which already
 * shows the entity's `PageHeader`: the section's title, description and
 * actions. Pages nested under a section (a role under Roles) pass `backHref`
 * to it. Server-safe.
 */
export default function SectionHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-6">
      {backHref && <BackLink href={backHref} label={backLabel} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="break-words text-lg font-semibold tracking-tight">{title}</h2>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
