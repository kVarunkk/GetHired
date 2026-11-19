import { cn } from "@/utils/utils";

/**
 * A vertical-sidebar item label. It stays mounted when the sidebar is
 * collapsed and fades instead, so items don't jump while the width animates.
 * The sidebar clips it (overflow-x-hidden), and screen readers still get the
 * item's name when it's collapsed.
 *
 * A label longer than the open sidebar ends in an ellipsis (min-w-0 lets it
 * shrink inside the row's flex), with the full text as its title. `trailing`
 * (a count or a badge) never shrinks, so it stays visible after a long label.
 */
export default function SidebarLabel({
  open,
  children,
  trailing,
}: {
  open: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center text-sm transition-opacity duration-300 ease-in-out",
        open ? "opacity-100" : "opacity-0",
      )}
    >
      <span
        className="truncate"
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </span>
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
    </span>
  );
}
