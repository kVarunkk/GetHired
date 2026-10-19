"use client";

import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { Switch } from "./ui/switch";
import { useJobPostingStatus } from "@/hooks/useJobPostingStatus";
import RoleLocked from "./team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import DataTable, { SelectFilter, SortableHeader, TextFilter } from "./DataTable";
import { Link as ModifiedLink } from "react-transition-progress/next";
import { IJobPost } from "@/utils/types";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";

interface JobPostingsTableProps {
  data: IJobPost[];
  /** Job ids whose status switch the viewer may use (jobs.publish, RP-REQ-016). Omitted: all. */
  publishable?: string[];
}

const JOB_STATUSES = ["active", "inactive"];

export const JobStatusSwitch = ({
  job,
  disabled = false,
}: {
  job: IJobPost | TCompanyIdPageData;
  /** Without jobs.publish on this job (RP-REQ-016). */
  disabled?: boolean;
}) => {
  const { checkedState, handleUpdateStatus, upgradeDialog } =
    useJobPostingStatus(job.status, job);

  if (disabled) {
    return (
      <RoleLocked reason={forbiddenMessage("jobs.publish")}>
        <Switch
          checked={checkedState}
          disabled
          aria-label={checkedState ? "Job is active" : "Job is inactive"}
        />
      </RoleLocked>
    );
  }

  return (
    <div className="flex items-center">
      <Switch
        title={`${checkedState ? "Deactivate" : "Activate"}`}
        checked={checkedState}
        onCheckedChange={handleUpdateStatus}
      />
      {upgradeDialog}
    </div>
  );
};

export default function JobPostingsTable({
  data,
  publishable,
}: JobPostingsTableProps) {
  const jobTypes = useMemo(() => {
    const types = data.map((item) => item.job_type);

    return [...new Set(types)];
  }, [data]);

  const columns: ColumnDef<IJobPost>[] = useMemo(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <JobStatusSwitch job={row.original} disabled={publishable ? !publishable.includes(row.original.id) : false} />
        ),
        filterFn: "equals",
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
    [publishable],
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      noun="job postings"
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
          <SelectFilter
            table={table}
            column="status"
            allLabel="All Statuses"
            options={JOB_STATUSES}
            label="Filter by status"
          />
        </>
      )}
    />
  );
}
