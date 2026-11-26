"use client";

import useSWR from "swr";
import { toIsoCurrency } from "@/helpers/currency/currencies";
import { formatSalaryAmount, lowSalaryHint } from "@/helpers/salary/period";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";

type SalaryInput = { minSalary?: unknown; maxSalary?: unknown; salaryCurrency?: unknown };

const LABELS = { minSalary: "minimum", maxSalary: "maximum" } as const;

/**
 * The onboarding form's low-salary warning (lowSalaryHint), on the agent's
 * approval card: salaries are saved per year, and a monthly amount sent as a
 * yearly one is the usual mistake. A call that changes only the amount uses
 * the profile's currency.
 */
export function SalaryApprovalWarning({ input }: { input: unknown }) {
  const values = (input ?? {}) as SalaryInput;
  const amounts = (["minSalary", "maxSalary"] as const).flatMap((key) => {
    const amount = values[key];
    return typeof amount === "number" ? [{ key, amount }] : [];
  });
  const inputCurrency = toIsoCurrency(
    typeof values.salaryCurrency === "string" ? values.salaryCurrency : null,
  );

  const { data } = useSWR(amounts.length > 0 && !inputCurrency ? PROFILE_API_KEY : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });
  const currency = inputCurrency ?? toIsoCurrency(data?.profile?.salary_currency);
  if (!currency) return null;

  const warnings = amounts.flatMap(({ key, amount }) => {
    const hint = lowSalaryHint(amount, "year", currency);
    if (!hint) return [];
    const shown = formatSalaryAmount(amount, currency);
    return [
      hint.kind === "month"
        ? `A ${LABELS[key]} of ${shown} is low for a year. If that's per month, it's ${formatSalaryAmount(hint.annual, currency)} a year.`
        : `A ${LABELS[key]} of ${shown} is low for a year.`,
    ];
  });
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
    >
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      <p className="text-muted-foreground">
        Salaries are saved per year. If this isn&apos;t right, decline and tell the assistant the
        yearly amount.
      </p>
    </div>
  );
}
