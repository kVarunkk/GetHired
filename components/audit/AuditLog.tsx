"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAuditAction } from "@/app/actions/audit/list-audit";
import {
  AUDIT_ACTION_GROUP_LABEL,
  AUDIT_ACTION_GROUP_VALUES,
  auditActorLabel,
  describeAuditEntry,
  type AuditEntry,
  type AuditFilters,
} from "@/helpers/companies/audit";

const ANY = "any";

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
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4" role="group" aria-label="Filters">
        <div className="grid gap-1.5">
          <Label htmlFor="audit-actor">Who</Label>
          <Select value={filters.actor ?? ANY} onValueChange={(v) => applyFilter({ actor: v === ANY ? null : v })}>
            <SelectTrigger id="audit-actor" aria-label="Who">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anyone</SelectItem>
              {actors.map((a) => (
                <SelectItem key={a.userId} value={a.userId}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-action">What</Label>
          <Select
            value={filters.action ?? ANY}
            onValueChange={(v) => applyFilter({ action: v === ANY ? null : (v as AuditFilters["action"]) })}
          >
            <SelectTrigger id="audit-action" aria-label="What">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Everything</SelectItem>
              {AUDIT_ACTION_GROUP_VALUES.map((g) => (
                <SelectItem key={g} value={g}>
                  {AUDIT_ACTION_GROUP_LABEL[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-since">From</Label>
          <Input
            id="audit-since"
            type="date"
            value={filters.since ?? ""}
            max={filters.until ?? undefined}
            onChange={(e) => applyFilter({ since: e.target.value || null })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-until">To</Label>
          <Input
            id="audit-until"
            type="date"
            value={filters.until ?? ""}
            min={filters.since ?? undefined}
            onChange={(e) => applyFilter({ until: e.target.value || null })}
          />
        </div>
      </div>
      {filtered && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push(pathname)}>
          Clear filters
        </Button>
      )}

      {entries.length === 0 ? (
        <p className="rounded-lg border p-6 text-sm text-muted-foreground">
          {filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."}
        </p>
      ) : (
        <ol className="divide-y rounded-lg border" aria-label="Audit log">
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {nextBefore !== null && (
        <Button variant="outline" className="w-fit" disabled={loading} onClick={loadMore}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { text, details } = describeAuditEntry(entry);
  const when = new Date(entry.createdAt);
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{auditActorLabel(entry)}</span> {text}
          {entry.actorKind === "agent" && (
            <Bot className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Recruiter agent" />
          )}
        </p>
        <time dateTime={entry.createdAt} title={format(when, "PPpp")} className="text-xs text-muted-foreground">
          {formatDistanceToNow(when, { addSuffix: true })}
        </time>
      </div>
      {details.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
