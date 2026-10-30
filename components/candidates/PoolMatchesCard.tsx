"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Loader2, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { describeAddToJob } from "@/helpers/candidates/copy";
import { candidatePath } from "@/helpers/candidates/paths";
import { POOL_MATCH_LABEL } from "@/helpers/candidates/pool-match";
import type { PoolMatch, PoolMatches } from "@/helpers/candidates/pool-matches";

export const POOL_MATCHES_TITLE = "From your candidates";
const NO_EMAIL = "Add an email first";
/** Radix SelectItem can't have an empty value. */
const FIRST_STAGE = "first";

/**
 * A job's matches among the company's own candidates (CP-REQ-060), the body
 * of the job's "From your candidates" section: name,
 * title, location, similarity and badges, with "Add to job" one at a time or
 * for the selected. `stages` is null without applicants.import for the job,
 * which hides adding. Adding emails no one.
 */
export default function PoolMatchesCard({
  jobId,
  status,
  matches,
  stages,
}: {
  jobId: string;
  status: Extract<PoolMatches, { ok: true }>["status"];
  matches: PoolMatch[];
  stages: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const canAdd = stages !== null;
  const [stageId, setStageId] = useState(FIRST_STAGE);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (candidateIds: string[], key: string) => {
    setBusy(key);
    try {
      const result = await addCandidatesToJobAction({
        jobPostId: jobId,
        candidateIds,
        ...(stageId !== FIRST_STAGE ? { stageId } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(describeAddToJob(result.counts));
      setRowSelection({});
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const columns: ColumnDef<PoolMatch>[] = useMemo(
    () => [
      ...(canAdd
        ? [
            {
              id: "select",
              header: () => null,
              cell: ({ row }) => (
                <Checkbox
                  aria-label={`Select ${row.original.name}`}
                  disabled={!row.original.hasEmail}
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                />
              ),
              meta: { className: "w-8", headerClassName: "w-8" },
            } satisfies ColumnDef<PoolMatch>,
          ]
        : []),
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="max-w-xs">
            <Link href={candidatePath(row.original.id)} className="block truncate font-medium hover:underline">
              {row.original.name}
            </Link>
            {row.original.title && (
              <div className="truncate text-xs text-muted-foreground">{row.original.title}</div>
            )}
          </div>
        ),
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => <div className="text-sm capitalize">{row.original.location ?? "—"}</div>,
      },
      {
        id: "similarity",
        header: POOL_MATCH_LABEL,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">
              {POOL_MATCH_LABEL} {row.original.score}
            </Badge>
            {row.original.hasResume && <Badge variant="secondary">Resume</Badge>}
            {!row.original.hasEmail && <Badge variant="secondary">No email</Badge>}
          </div>
        ),
      },
      ...(canAdd
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              cell: ({ row }) => (
                // A disabled button gets no hover, so the reason sits on its wrapper.
                <span title={row.original.hasEmail ? "Add to job" : NO_EMAIL}>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Add ${row.original.name} to the job`}
                    disabled={!row.original.hasEmail || busy !== null}
                    onClick={() => void add([row.original.id], row.original.id)}
                  >
                    {busy === row.original.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span className="ml-1">Add</span>
                  </Button>
                </span>
              ),
              meta: { className: "w-24 text-right", headerClassName: "w-24" },
            } satisfies ColumnDef<PoolMatch>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canAdd, busy, stageId],
  );

  const selected = matches.filter((m) => rowSelection[m.id] && m.hasEmail).map((m) => m.id);

  return (
    <section aria-label={POOL_MATCHES_TITLE} className="flex flex-col gap-4">
      {canAdd && status === "ok" && matches.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pool-matches-stage" className="text-xs text-muted-foreground">
              Stage
            </Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger id="pool-matches-stage" aria-label="Stage" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIRST_STAGE}>The job&apos;s first stage</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected.length > 0 && (
            <Button variant="brand" disabled={busy !== null} onClick={() => void add(selected, "selected")}>
              {busy === "selected" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add selected ({selected.length})
            </Button>
          )}
        </div>
      )}

      {status === "no_job_embedding" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding matches… This takes a minute after a job is saved.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one in your candidates is close to this job yet.</p>
      ) : (
        <DataTable
          aria-label={POOL_MATCHES_TITLE}
          data={matches}
          columns={columns}
          noun="candidates"
          getRowId={(m) => m.id}
          enableRowSelection={canAdd}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          pageSize={10}
        />
      )}
    </section>
  );
}
