import type { CreditCost } from "@/utils/credit-costs";

/** "What uses credits": one bordered row per feature, its cost on the right. */
export default function CreditCostList({
  costs,
  label = "What uses credits",
}: {
  costs: CreditCost[];
  label?: string;
}) {
  return (
    <ul aria-label={label} className="divide-y rounded-xl border">
      {costs.map((row) => (
        <li
          key={row.feature}
          className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.feature}</span>
            {row.detail && (
              <span className="text-muted-foreground">{row.detail}</span>
            )}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {row.cost}
          </span>
        </li>
      ))}
    </ul>
  );
}
