"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { formatDate } from "@/utils/date";
import type { ColumnDef } from "@tanstack/react-table";
import { Bot, Loader2 } from "lucide-react";
import DataTable, { DataTableFooter, FilterSelect } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAuditAction } from "@/app/actions/audit/list-audit";
import {
  AUDIT_ACTION_GROUP_LABEL,
  AUDIT_ACTION_GROUP_VALUES,
  auditActorLabel,
  describeAuditEntry,
  type AuditEntry,
  type AuditFilters,
} from "@/helpers/companies/audit";

const COLUMNS: ColumnDef<AuditEntry>[] = [
  {
    id: "when",
    header: "When",
    cell: ({ row }) => {
      const when = new Date(row.original.createdAt);
      return (
        <time dateTime={row.original.createdAt} suppressHydrationWarning title={formatDate(when, { dateStyle: "medium", timeStyle: "medium" }, "en-US")}>
          {formatDistanceToNow(when, { addSuffix: true })}
        </time>
      );
    },
    meta: { className: "align-top text-muted-foreground" },
  },
  {
    id: "who",
    header: "Who",
    cell: ({ row }) => (
      <>
        {auditActorLabel(row.original)}
        {row.original.actorKind === "agent" && (
          <Bot className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Recruiter agent" />
        )}
      </>
    ),
    meta: { className: "align-top font-medium" },
  },
  {
    id: "what",
    header: "What",
    cell: ({ row }) => {
      const { text, details } = describeAuditEntry(row.original);
      return (
        <>
          <p className="first-letter:uppercase">{text}</p>
          {details.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </>
      );
    },
    meta: { className: "min-w-64 whitespace-normal align-top" },
  },
];

/**
 * RP-REQ-015 / RPT-072: the audit log, newest first. Filters live in the
 * URL, so the server page loads the first page; "Load more" asks for the
 * next one with the same filters.
 */
export default function AuditLog({
  initialEntries,
  initialNextBefore,
  filters,
  actors,
}: {
  initialEntries: AuditEntry[];
  initialNextBefore: number | null;
  filters: AuditFilters;
  actors: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [entries, setEntries] = useState(initialEntries);
  const [nextBefore, setNextBefore] = useState(initialNextBefore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New filters come back as new props from the server page.
  const [shownFor, setShownFor] = useState(initialEntries);
  if (shownFor !== initialEntries) {
    setShownFor(initialEntries);
    setEntries(initialEntries);
    setNextBefore(initialNextBefore);
    setError(null);
  }

  function applyFilter(patch: Partial<AuditFilters>) {
    const next = { ...filters, ...patch };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  async function loadMore() {
    if (nextBefore === null) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listAuditAction({ before: nextBefore, ...filters });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries((current) => [...current, ...result.entries]);
      setNextBefore(result.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  const filtered = Boolean(filters.actor || filters.action || filters.since || filters.until);

  return (
    <DataTable
      aria-label="Audit log"
      data={entries}
      columns={COLUMNS}
      noun="entries"
      emptyMessage={filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."}
      externalFiltersActive={filtered}
      onClearFilters={() => router.push(pathname)}
      filters={() => (
        <>
          <FilterSelect
            value={filters.actor ?? null}
            onChange={(actor) => applyFilter({ actor })}
            allLabel="Anyone"
            options={actors.map((a) => ({ value: a.userId, label: a.name }))}
            label="Who"
          />
          <FilterSelect
            value={filters.action ?? null}
            onChange={(action) => applyFilter({ action: action as AuditFilters["action"] })}
            allLabel="Everything"
            options={AUDIT_ACTION_GROUP_VALUES.map((g) => ({ value: g, label: AUDIT_ACTION_GROUP_LABEL[g] }))}
            label="What"
          />
          <div className="flex shrink-0 items-center gap-2">
            <Label htmlFor="audit-since" className="text-sm font-normal text-muted-foreground">
              From
            </Label>
            <Input
              id="audit-since"
              type="date"
              className="w-[150px] text-sm"
              value={filters.since ?? ""}
              max={filters.until ?? undefined}
              onChange={(e) => applyFilter({ since: e.target.value || null })}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Label htmlFor="audit-until" className="text-sm font-normal text-muted-foreground">
              To
            </Label>
            <Input
              id="audit-until"
              type="date"
              className="w-[150px] text-sm"
              value={filters.until ?? ""}
              min={filters.since ?? undefined}
              onChange={(e) => applyFilter({ until: e.target.value || null })}
            />
          </div>
        </>
      )}
      footer={
        <DataTableFooter
          summary={
            error ? (
              <span role="alert" className="text-destructive">
                {error}
              </span>
            ) : (
              `Showing ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
            )
          }
        >
          {nextBefore !== null && (
            <Button variant="outline" size="sm" disabled={loading} onClick={loadMore}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Load more
            </Button>
          )}
        </DataTableFooter>
      }
    />
  );
}
