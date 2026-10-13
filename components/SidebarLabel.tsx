import { cn } from "@/utils/utils";

/**
 * A vertical-sidebar item label. It stays mounted when the sidebar is
 * collapsed and fades instead, so items don't jump while the width animates.
 * The sidebar clips it (overflow-x-hidden), and screen readers still get the
 * item's name when it's collapsed.
 */
export default function SidebarLabel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm transition-opacity duration-300 ease-in-out",
        open ? "opacity-100" : "opacity-0",
      )}
    >
      {children}
    </span>
  );
}
