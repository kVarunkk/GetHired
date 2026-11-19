/**
 * A row of a desktop sidebar: the main sidebar (`Navbar`) and the secondary
 * one (`EntityNav`) share it, so the two read as one system. px-4 centres the
 * 16px icon in the collapsed 64px rail, so it never moves.
 */
export const SIDEBAR_ROW =
  "flex w-full items-center gap-2 overflow-hidden rounded-md px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground";

/** The current page's row. */
export const SIDEBAR_ROW_ACTIVE = "bg-muted font-medium text-foreground";
