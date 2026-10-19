import type { ReactNode } from "react";
import EntityNav, { type EntityNavItem } from "@/components/EntityNav";

/**
 * The frame of a page with sections (a job post, an application, settings):
 * the secondary sidebar on the left, then the entity's `PageHeader` and the
 * section's page. Pages under it start with a `SectionHeader`.
 */
export default function EntityLayout({
  nav,
  header,
  children,
}: {
  nav: {
    label: string;
    title?: ReactNode;
    backHref?: string;
    backLabel?: string;
    items: EntityNavItem[];
  };
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col md:min-h-dvh md:flex-row">
      <EntityNav {...nav} />
      {/* No bottom padding here: some sections end with a sticky save bar. */}
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-0">
        {header}
        {children}
      </div>
    </div>
  );
}
