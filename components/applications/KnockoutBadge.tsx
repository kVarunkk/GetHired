import { Badge } from "@/components/ui/badge";

export type KnockoutSummary = {
  failed: boolean;
  reasons: unknown;
  action_taken?: string | null;
} | null;

/** The labels of the questions an application failed (reasons are stored as JSON). */
export function knockoutReasons(knockout: KnockoutSummary): string[] {
  if (!knockout?.failed || !Array.isArray(knockout.reasons)) return [];
  return knockout.reasons
    .map((r) => (r && typeof r === "object" && typeof (r as { label?: unknown }).label === "string" ? (r as { label: string }).label : null))
    .filter((label): label is string => Boolean(label));
}

/**
 * AF-REQ-003: shown to the company on applicant rows, board cards and the
 * applicant page when an application failed a knockout rule. Company-only
 * (AF-SEC-003): the data comes from application_knockouts through RLS.
 */
export default function KnockoutBadge({ knockout }: { knockout: KnockoutSummary }) {
  if (!knockout?.failed) return null;
  const reasons = knockoutReasons(knockout);
  const title = reasons.length ? `Didn't meet: ${reasons.join("; ")}` : undefined;
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive" title={title}>
      Didn&apos;t meet requirements
      {reasons.length > 0 && <span className="sr-only">: {reasons.join("; ")}</span>}
    </Badge>
  );
}
