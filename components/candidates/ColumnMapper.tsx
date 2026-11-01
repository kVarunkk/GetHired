"use client";

import { ShieldAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  COLUMN_TARGETS,
  protectedHeaderReason,
  TARGET_LABELS,
  withTarget,
  type ColumnMapping,
  type ColumnTarget,
} from "@/helpers/candidates/map-columns";

/** The order targets are offered in: fields, then the ways to keep an unmapped column. */
const OFFERED: ColumnTarget[] = [
  "full_name",
  "first_name",
  "last_name",
  ...COLUMN_TARGETS.filter(
    (t) => !["full_name", "first_name", "last_name", "stage", "tag", "note", "ignore"].includes(t),
  ),
  "tag",
  "note",
  "ignore",
];

/**
 * BI-REQ-011: each column of the file with a sample and the field it maps to.
 * Headers that name a protected characteristic stay ignored, with the reason
 * (BI-SEC-005). The Stage column is offered only with a job destination
 * possible.
 */
export default function ColumnMapper({
  headers,
  samples,
  columns,
  onChange,
  allowStage,
  disabled = false,
}: {
  headers: string[];
  /** The first few data rows. */
  samples: string[][];
  columns: ColumnMapping;
  onChange: (columns: ColumnMapping) => void;
  /** Whether the member can import into a job (the Stage column needs one). */
  allowStage: boolean;
  disabled?: boolean;
}) {
  const targets = allowStage ? [...OFFERED.slice(0, -3), "stage" as const, ...OFFERED.slice(-3)] : OFFERED;
  return (
    <ul className="divide-y rounded-xl border" aria-label="Columns">
      {headers.map((header, i) => {
        const reason = protectedHeaderReason(header);
        const sample = samples
          .map((row) => row[i]?.trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(" · ");
        return (
          <li key={i} className="grid gap-2 p-4 sm:grid-cols-[1fr_16rem] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{header}</p>
              <p className="truncate text-sm text-muted-foreground">{sample || "No values in the first rows"}</p>
              {reason && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {reason}
                </p>
              )}
            </div>
            <Select
              value={columns[i] ?? "ignore"}
              onValueChange={(next) => onChange(withTarget(headers, columns, i, next as ColumnTarget))}
              disabled={disabled || reason !== null}
            >
              <SelectTrigger aria-label={`Map “${header}” to`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target} value={target}>
                    {TARGET_LABELS[target]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        );
      })}
    </ul>
  );
}
