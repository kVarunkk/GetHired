import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The heading row of every logged-in page: an optional back link (nested
 * pages only, never main pages), a small eyebrow line, the title with its
 * description, and the page's actions on the right (under the title on
 * mobile). Server-safe, so client components can render it too.
 */
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  backHref,
  backLabel = "Back",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {backHref && <BackLink href={backHref} label={backLabel} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>}
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The icon-only back link `PageHeader` renders. Exported for full-screen
 * views (resume review, live interview) that keep their own compact header.
 */
export function BackLink({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="w-fit p-2 pl-0 text-muted-foreground transition-colors hover:text-primary"
      aria-label={label}
    >
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}
