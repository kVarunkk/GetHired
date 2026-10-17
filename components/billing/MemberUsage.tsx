import { Badge } from "@/components/ui/badge";
import { ALLOWANCE_KEYS, KEY_LABELS } from "@/helpers/billing/keys";
import type { MemberUsageRow } from "@/helpers/billing/member-usage";

/** RP-REQ-044: what each member spent this period, against their role's caps. */
export default function MemberUsage({ rows }: { rows: MemberUsageRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold tracking-tight">Usage by member</h3>
        <p className="text-sm text-muted-foreground">
          This month&apos;s usage per person. Caps come from each member&apos;s role.
        </p>
      </div>
      <ul className="divide-y rounded-xl border" aria-label="Usage by member">
        {rows.map((row) => {
          const keys = ALLOWANCE_KEYS.filter((k) => (row.usage[k] ?? 0) > 0 || row.limits[k] !== undefined);
          return (
            <li key={row.userId} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
              <span className="flex items-center gap-2">
                <span className="font-medium">{row.name}</span>
                <Badge variant="secondary">{row.isOwner ? "Owner" : (row.roleName ?? "No role")}</Badge>
              </span>
              {keys.length === 0 ? (
                <span className="text-muted-foreground">No usage yet</span>
              ) : (
                <ul className="flex flex-col gap-1 sm:items-end">
                  {keys.map((key) => {
                    const used = row.usage[key] ?? 0;
                    const limit = row.limits[key];
                    const atCap = limit !== undefined && used >= limit;
                    return (
                      <li
                        key={key}
                        data-testid={`member-usage-${row.userId}-${key}`}
                        className={atCap ? "text-destructive tabular-nums" : "tabular-nums"}
                      >
                        <span className="capitalize">{KEY_LABELS[key].many}</span>:{" "}
                        {limit === undefined ? used.toLocaleString("en-US") : `${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")}`}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
