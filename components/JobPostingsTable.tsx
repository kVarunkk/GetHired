"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import DataTable, { FilterSelect, SelectFilter, SortableHeader, TextFilter } from "./DataTable";
import JobStateMenu from "./jobs/JobStateMenu";
import { Link as ModifiedLink } from "react-transition-progress/next";
import { IJobPost } from "@/utils/types";
import {
  DEFAULT_JOB_STATE_FILTER,
  JOB_STATE_FILTERS,
  statesForFilter,
  type JobStateFilter,
} from "@/helpers/jobs/job-states";

interface JobPostingsTableProps {
  data: IJobPost[];
  /** Job ids whose state the viewer may change (jobs.publish, RP-REQ-016). Omitted: all. */
  publishable?: string[];
  /** Job ids the viewer may approve (jobs.approve). Omitted: none. */
  approvable?: string[];
  /** `company_info.job_approval_required` (D6). */
  approvalRequired?: boolean;
  /** Hires per job id (JL-REQ-012). */
  hires?: Record<string, number>;
}

/** The URL parameter of the state filter. Absent means the default (open and paused). */
export const JOB_STATE_PARAM = "state";

/** JL-REQ-029: the filter's value from the URL; `all` is the filter's "All" option. */
export function stateFilterFrom(param: string | null): JobStateFilter {
  return JOB_STATE_FILTERS.some((f) => f.value === param) ? (param as JobStateFilter) : DEFAULT_JOB_STATE_FILTER;
}

export default function JobPostingsTable({
  data,
  publishable,
  approvable = [],
  approvalRequired = false,
  hires = {},
}: JobPostingsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stateFilter = stateFilterFrom(searchParams?.get(JOB_STATE_PARAM) ?? null);

  const setStateFilter = (value: JobStateFilter) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === DEFAULT_JOB_STATE_FILTER) params.delete(JOB_STATE_PARAM);
    else params.set(JOB_STATE_PARAM, value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : (pathname ?? ""), { scroll: false });
  };

  const rows = useMemo(() => {
    const states = statesForFilter(stateFilter) as readonly string[];
    return data.filter((job) => states.includes(job.state));
  }, [data, stateFilter]);

  const jobTypes = useMemo(() => {
    const types = data.map((item) => item.job_type);

    return [...new Set(types)];
  }, [data]);

  const columns: ColumnDef<IJobPost>[] = useMemo(
    () => [
      {
        accessorKey: "state",
        header: "Status",
        cell: ({ row }) => (
          <JobStateMenu
            key={`${row.original.id}:${row.original.state}`}
            job={row.original}
            viewer={{
              canPublish: publishable ? publishable.includes(row.original.id) : true,
              canApprove: approvable.includes(row.original.id),
              approvalRequired,
            }}
          />
        ),
      },
      {
        accessorKey: "title",
        header: ({ column }) => (
          <SortableHeader column={column} label="Job Title" />
        ),
        cell: ({ row }) => (
          <ModifiedLink
            href={`/company/job-posts/${row.original.id}`}
            className="block max-w-[16rem] truncate font-medium hover:underline"
            title={row.original.title}
          >
            {row.original.title}
          </ModifiedLink>
        ),
        filterFn: "includesString",
      },
      {
        accessorKey: "location",
        header: "Location",
        cell: ({ row }) => (
          <div
            className="max-w-[12rem] truncate text-sm"
            title={row.original.location.join(", ")}
          >
            {row.original.location.join(", ")}
          </div>
        ),
      },
      {
        accessorKey: "job_type",
        header: ({ column }) => (
          <SortableHeader column={column} label="Job Type" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">{row.original.job_type}</div>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "applications",
        header: ({ column }) => (
          <SortableHeader column={column} label="Applications" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {row.original.applications
              ? row.original.applications[0]?.count
              : 0}
          </div>
        ),
      },
      {
        id: "hired",
        header: "Hired",
        cell: ({ row }) => (
          <div className="text-sm tabular-nums" aria-label={`Hired ${hires[row.original.id] ?? 0} of ${row.original.openings}`}>
            {hires[row.original.id] ?? 0} / {row.original.openings}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink
            prefetch={false}
            href={`/company/job-posts/${row.original.id}`}
            passHref
          >
            <Button variant="ghost" size="sm">
              View Job
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </ModifiedLink>
        ),
      },
    ],
    [publishable, approvable, approvalRequired, hires],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      noun="job postings"
      externalFiltersActive={stateFilter !== DEFAULT_JOB_STATE_FILTER}
      onClearFilters={() => setStateFilter(DEFAULT_JOB_STATE_FILTER)}
      filters={(table) => (
        <>
          <TextFilter table={table} column="title" placeholder="Job Title" />
          <SelectFilter
            table={table}
            column="job_type"
            allLabel="All Types"
            options={jobTypes}
            label="Filter by job type"
          />
          <FilterSelect
            value={stateFilter === "all" ? null : stateFilter}
            onChange={(value) => setStateFilter((value as JobStateFilter | null) ?? "all")}
            allLabel="All"
            options={JOB_STATE_FILTERS.filter((f) => f.value !== "all").map((f) => ({ value: f.value, label: f.label }))}
            label="Filter by status"
          />
        </>
      )}
    />
  );
}
