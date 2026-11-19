import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/utils/utils";

/** How many entries of a list (skills, locations) a chip shows before "+N". */
export const MAX_CHIP_ITEMS = 3;

/** A list in one chip: "React, SQL, Python +14". */
export function chipListText(
  items: readonly (string | null | undefined)[] | null | undefined,
  max: number = MAX_CHIP_ITEMS,
): string {
  const list = (items ?? []).map((item) => item?.trim() ?? "").filter(Boolean);
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max}`;
}

/**
 * A one-line pill for a detail on a job, company or profile item. Text longer
 * than the row is cut with an ellipsis instead of wrapping out of the pill, so
 * pass the full text as `title`.
 */
export function DetailChip({ className, children, ...props }: BadgeProps) {
  return (
    <Badge
      className={cn(
        "min-w-0 max-w-full rounded-full text-xs font-medium sm:text-sm",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
    </Badge>
  );
}
