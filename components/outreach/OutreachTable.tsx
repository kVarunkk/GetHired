"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { DataTableFooter, FilterSelect, SortableHeader, TextFilter } from "@/components/DataTable";
import OutreachStatusBadge, { OUTREACH_STATUS_LABELS } from "@/components/outreach/OutreachStatusBadge";
import WithdrawOutreachButton from "@/components/outreach/WithdrawOutreachButton";
import { Button } from "@/components/ui/button";
import { OUTREACH_STATUSES, outreachPath } from "@/helpers/outreach/config";
import type { CompanyOutreachItem } from "@/helpers/outreach/list";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import MemberAvatar from "@/components/team/MemberAvatar";
import { formatDate } from "@/utils/date";

const shownDate = (iso: string | null) => formatDate(iso) || "—";

/**
 * The company's outreach (OR-REQ-007), laid out like the app's other tables.
 * The job and status filters live in the URL because the server pages and the
 * reply rate follow them; the candidate search filters the loaded page.
 */
export default function OutreachTable({
  items,
  jobs,
  jobPostId,
  status,
  cursor,
  nextCursor,
}: {
  items: CompanyOutreachItem[];
  jobs: { id: string; title: string }[];
  jobPostId: string | null;
  status: OutreachStatus | null;
  cursor: string | null;
  nextCursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = (next: { job?: string | null; status?: string | null; cursor?: string | null }) => {
    const params = new URLSearchParams();
    const job = next.job === undefined ? jobPostId : next.job;
    const nextStatus = next.status === undefined ? status : next.status;
    if (job) params.set("job", job);
    if (nextStatus) params.set("status", nextStatus);
    if (next.cursor) params.set("cursor", next.cursor);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const columns: ColumnDef<CompanyOutreachItem>[] = useMemo(
    () => [
      {
        id: "candidate",
        accessorFn: (row) => row.candidateName ?? "Candidate",
        header: ({ column }) => <SortableHeader column={column} label="Candidate" />,
        cell: ({ row }) => (
          <div className="max-w-xs">
            <Link
              href={`/company/profiles/${row.original.candidateUserId}`}
              className="block truncate font-medium hover:underline"
            >
              {row.original.candidateName ?? "Candidate"}
            </Link>
            <Link
              href={outreachPath(row.original.id)}
              className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
              title={row.original.subject ?? undefined}
            >
              {row.original.subject}
            </Link>
          </div>
        ),
        filterFn: "includesString",
      },
      {
        accessorKey: "jobTitle",
        header: "Job",
        cell: ({ row }) => (
          <div className="max-w-[16rem] truncate text-sm" title={row.original.jobTitle ?? undefined}>
            {row.original.jobTitle ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <OutreachStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "sentAt",
        header: ({ column }) => <SortableHeader column={column} label="Sent" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-sm">
            {/* TM-REQ-008: who sent it, as stored at send time. */}
            {row.original.senderName && <MemberAvatar name={row.original.senderName} className="h-6 w-6" />}
            <div className="min-w-0 max-w-[10rem]">
              <div>{shownDate(row.original.sentAt)}</div>
              {row.original.senderName && (
                <div className="truncate text-xs text-muted-foreground" title={row.original.senderName}>
                  by {row.original.senderName}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "respondedAt",
        accessorFn: (row) => row.respondedAt ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Responded" />,
        cell: ({ row }) => <div className="text-sm">{shownDate(row.original.respondedAt)}</div>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button asChild size="sm" variant="ghost">
              <Link href={outreachPath(row.original.id)}>View</Link>
            </Button>
            {row.original.status === "sent" && <WithdrawOutreachButton outreachId={row.original.id} />}
          </div>
        ),
      },
    ],
    [],
  );

  // The candidate search is a column filter; the job and status filters are in the URL.
  const urlFiltered = jobPostId !== null || status !== null;

  return (
    <DataTable
      data={items}
      columns={columns}
      noun="messages"
      emptyMessage={
        items.length > 0 || urlFiltered || cursor ? (
          "No outreach found."
        ) : (
          <>
            No outreach yet. Outreach starts from a candidate&apos;s profile: find someone in{" "}
            <Link href="/company/profiles" className="underline hover:text-brand">
              Profiles
            </Link>{" "}
            and choose Reach out.
          </>
        )
      }
      externalFiltersActive={urlFiltered}
      onClearFilters={() => {
        if (jobPostId || status || cursor) navigate({ job: null, status: null, cursor: null });
      }}
      filters={(table) => (
        <>
          <TextFilter table={table} column="candidate" placeholder="Candidate" />
          <FilterSelect
            value={jobPostId}
            onChange={(job) => navigate({ job, cursor: null })}
            allLabel="All Jobs"
            options={jobs.map((job) => ({ value: job.id, label: job.title }))}
            label="Filter by job"
          />
          <FilterSelect
            value={status}
            onChange={(next) => navigate({ status: next, cursor: null })}
            allLabel="All Statuses"
            options={OUTREACH_STATUSES.map((s) => ({ value: s, label: OUTREACH_STATUS_LABELS[s].label }))}
            label="Filter by status"
          />
        </>
      )}
      footer={
        <DataTableFooter summary={`Showing ${items.length} ${items.length === 1 ? "message" : "messages"}`}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ cursor: null })}
            disabled={!cursor}
            className="min-w-0"
          >
            <span className="truncate">Newest</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ cursor: nextCursor })}
            disabled={!nextCursor}
            className="min-w-0"
          >
            <span className="truncate">Older</span>
          </Button>
        </DataTableFooter>
      }
    />
  );
}
