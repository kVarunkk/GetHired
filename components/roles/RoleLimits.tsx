"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LIMIT_KEYS, type RoleLimitKey, type RoleLimits as Limits } from "@/helpers/companies/permissions";

const LABELS: Record<RoleLimitKey, string> = {
  screenings: "AI screenings",
  outreach: "Outreach messages",
  agent_messages: "Agent messages",
  match_explanations: "Match explanations",
  interview_minutes: "Interview minutes",
};

/**
 * RP-REQ-040 / RPT-062: per-member monthly caps. Empty means "No limit" (only
 * the company's allowance applies); 0 blocks the key. A cap can't go above
 * the editor's own role's cap (RP-REQ-012 rule 1); owners have none.
 */
export default function RoleLimits({
  value,
  ceiling,
  disabled,
  onChange,
}: {
  value: Limits;
  /** The viewer's own caps; a key not here has no ceiling. */
  ceiling: Limits;
  disabled: boolean;
  onChange: (next: Limits) => void;
}) {
  const set = (key: RoleLimitKey, raw: string) => {
    const next = { ...value };
    if (raw.trim() === "") delete next[key];
    else {
      const n = Math.max(0, Math.floor(Number(raw)));
      if (Number.isFinite(n)) next[key] = ceiling[key] !== undefined ? Math.min(n, ceiling[key]!) : n;
    }
    onChange(next);
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-5" aria-label="Usage limits">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Usage limits</h2>
        <p className="text-sm text-muted-foreground">
          How much each person with this role can use per month. Leave a field empty for no limit beyond your
          plan; 0 turns it off.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROLE_LIMIT_KEYS.map((key) => {
          const max = ceiling[key];
          const id = `limit-${key}`;
          return (
            <div key={key} className="grid gap-1">
              <Label htmlFor={id}>{LABELS[key]}</Label>
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                placeholder="No limit"
                disabled={disabled}
                value={value[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
              />
              {max !== undefined && (
                <p className="text-xs text-muted-foreground">Up to {max}, your own role&apos;s limit.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
