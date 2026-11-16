"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { SortableHeader } from "@/components/DataTable";
import InterviewTime from "@/components/interviews/InterviewTime";
import { STATUS_LABELS } from "@/components/interviews/section/interview-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { myInterviewTab, type MyInterview, type MyInterviewTab } from "@/helpers/interviews/my-interviews-view";

const TABS: { value: MyInterviewTab; label: string; empty: string }[] = [
  { value: "upcoming", label: "Upcoming", empty: "No upcoming interviews." },
  { value: "feedback", label: "Needs feedback", empty: "No scorecards to write. You're all caught up." },
  { value: "past", label: "Past", empty: "No past interviews." },
];

const SCORECARD_LABELS: Record<MyInterview["scorecardStatus"], string> = {
  none: "Not started",
  draft: "Draft",
  submitted: "Submitted",
};

/**
 * The member's own interviews (IVT-021): upcoming, waiting for their
 * scorecard, and past, each linking to the interview kit.
 */
export default function MyInterviewsTable({ interviews }: { interviews: MyInterview[] }) {
  const [now] = useState(() => Date.now());
  const byTab = useMemo(() => {
    const groups: Record<MyInterviewTab, MyInterview[]> = { upcoming: [], feedback: [], past: [] };
    for (const i of interviews) groups[myInterviewTab(i, now)].push(i);
    // Soonest first for upcoming; most recent first otherwise.
    groups.upcoming.sort((a, b) => (a.startsAt ?? "9").localeCompare(b.startsAt ?? "9"));
    return groups;
  }, [interviews, now]);
  const [tab, setTab] = useState<MyInterviewTab>(
    byTab.feedback.length > 0 && byTab.upcoming.length === 0 ? "feedback" : "upcoming",
  );

  const columns: ColumnDef<MyInterview>[] = useMemo(
    () => [
      {
        id: "when",
        accessorFn: (row) => row.startsAt ?? "",
        header: ({ column }) => <SortableHeader column={column} label="When" />,
        cell: ({ row }) => <InterviewTime startsAt={row.original.startsAt} endsAt={row.original.endsAt} />,
      },
      {
        id: "interview",
        accessorFn: (row) => row.name,
        header: "Interview",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-medium [overflow-wrap:anywhere]">{row.original.name}</span>
            <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {row.original.candidateName} · {row.original.jobTitle}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className="whitespace-nowrap font-normal">
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "scorecard",
        accessorFn: (row) => row.scorecardStatus,
        header: "Your scorecard",
        cell: ({ row }) =>
          row.original.status === "cancelled" || row.original.status === "no_show" ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            SCORECARD_LABELS[row.original.scorecardStatus]
          ),
      },
      {
        id: "open",
        header: () => <span className="sr-only">Open</span>,
        cell: ({ row }) =>
          row.original.kitOpen || row.original.scorecardStatus === "submitted" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/company/interviews/${row.original.interviewId}`}>
                {myInterviewTab(row.original, now) === "feedback" ? "Write scorecard" : "Open kit"}
              </Link>
            </Button>
          ) : null,
        meta: { className: "text-right" },
      },
    ],
    [now],
  );

  const current = TABS.find((t) => t.value === tab)!;

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as MyInterviewTab)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {byTab[t.value].length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{byTab[t.value].length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        aria-label={current.label}
        data={byTab[tab]}
        columns={columns}
        noun="interviews"
        emptyMessage={current.empty}
        getRowId={(row) => row.interviewId}
      />
    </div>
  );
}
