import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/utils";
import type { CareersPage } from "@/helpers/careers/get-careers-page";

/** GetHired's brand indigo, for pages without an accent. */
export const DEFAULT_ACCENT = "#4f46e5";

/**
 * The careers page frame: the company's accent as a CSS variable (never raw
 * CSS, CP-SEC-003), GetHired's fonts and layout, and the footer (CP-REQ-010).
 */
export default function CareersShell({
  page,
  banner,
  embedded = false,
  children,
}: {
  page: Pick<CareersPage, "accentColor">;
  banner?: ReactNode;
  /** Inside the editor's preview: no full-screen height. */
  embedded?: boolean;
  children: ReactNode;
}) {
  const style = { "--careers-accent": page.accentColor ?? DEFAULT_ACCENT } as CSSProperties;
  // Full width, with the public navbar's padding so the edges line up. The
  // editor's preview pane is narrower than the viewport, so it skips the
  // viewport-sized padding.
  const gutter = embedded ? "px-4 sm:px-6" : "px-4 lg:px-20 xl:px-40 2xl:px-80";
  return (
    <div style={style} className={embedded ? "bg-background" : "min-h-screen bg-background"} data-careers-page>
      {banner}
      <div className={cn("flex w-full flex-col gap-10 py-8 sm:py-12", gutter)}>{children}</div>
      <footer className={cn("w-full py-6 text-center text-xs text-muted-foreground", gutter)}>
        <div className="border-t pt-6">
          Powered by{" "}
          <Link href="/" className="font-medium text-foreground hover:underline">
            GetHired
          </Link>
        </div>
      </footer>
    </div>
  );
}
