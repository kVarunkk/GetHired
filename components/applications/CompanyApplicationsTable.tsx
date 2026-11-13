"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import DataTable, { DataTableFooter, FilterSelect } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApplicantNameCell,
  DateCell,
  FitCell,
  JobTitleCell,
  StatusCell,
  ViewApplicationCell,
} from "@/components/applications/application-columns";
import { useDebounce } from "@/hooks/useDebounce";
import type { CompanyApplicationRow } from "@/helpers/applications/company-list";
import {
  APPLICATION_STATUSES,
  applicationListHref,
  type ApplicationListParams,
  type ApplicationSort,
} from "@/helpers/applications/list-params";
import { RECOMMENDATION_LABELS, type ScreeningRecommendation } from "@/helpers/matching/config";

const SEARCH_DEBOUNCE_MS = 300;

const recommendationOptions = (Object.keys(RECOMMENDATION_LABELS) as ScreeningRecommendation[]).map((r) => ({
  value: r,
  label: RECOMMENDATION_LABELS[r],
}));
const knockoutOptions = [
  { value: "failed", label: "Didn't meet requirements" },
  { value: "passed", label: "Met requirements" },
];

const formatCount = (n: number) => n.toLocaleString("en-US");

/**
 * The company Applications page's list (QF-REQ-023/024): filtered, sorted and
 * paged by the server through the URL, with the same cells as the job page's
 * ApplicantsTable.
 */
export default function CompanyApplicationsTable({
  list,
  params,
}: {
  list: { rows: CompanyApplicationRow[]; total: number; page: number; pageSize: number; jobs: { id: string; title: string }[] };
  /** The parsed URL state; `page` is the page shown. */
  params: ApplicationListParams;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);

  const navigate = (patch: Partial<ApplicationListParams>) =>
    router.push(applicationListHref(params, patch), { scroll: false });

  useEffect(() => {
    if (debouncedSearch !== (params.q ?? "")) navigate({ q: debouncedSearch || null });
    // Only a new search term navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const columns: ColumnDef<CompanyApplicationRow>[] = useMemo(() => {
    const sortHeader = (sort: ApplicationSort, label: string) =>
      function Header() {
        return (
          <Button
            variant="ghost"
            onClick={() =>
              navigate(
                params.sort === sort
                  ? { dir: params.dir === "asc" ? "desc" : "asc" }
                  : { sort },
              )
            }
          >
            {label}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      };
    return [
      {
        id: "person_name",
        header: sortHeader("person_name", "Applicant Name"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <ApplicantNameCell
              name={r.person_name ?? ""}
              person={
                r.company_candidate_id
                  ? {
                      imported: true,
                      hasResume: r.candidate_has_resume ?? true,
                      connectedUserId: r.applicant_user_id ?? undefined,
                    }
                  : null
              }
              knockout={
                r.knockout_failed === null ? null : { failed: r.knockout_failed, reasons: r.knockout_reasons }
              }
            />
          );
        },
      },
      {
        id: "job_title",
        header: "Job Title",
        cell: ({ row }) => <JobTitleCell jobId={row.original.job_post_id} title={row.original.job_title ?? ""} />,
      },
      {
        id: "fit_score",
        header: sortHeader("fit_score", "Fit"),
        cell: ({ row }) => (
          <FitCell fitScore={row.original.fit_score} screeningStatus={row.original.screening_status} />
        ),
      },
      {
        id: "status",
        header: sortHeader("status", "Status"),
        cell: ({ row }) => <StatusCell status={row.original.status} />,
      },
      {
        id: "created_at",
        header: sortHeader("created_at", "Date Applied"),
        cell: ({ row }) => <DateCell date={row.original.created_at} />,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => <ViewApplicationCell id={row.original.id ?? ""} />,
      },
    ];
    // navigate reads params, which the columns already depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const filtered = Boolean(params.q || params.job || params.status || params.recommendation || params.knockout);
  const start = (list.page - 1) * list.pageSize;
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const shownFrom = list.rows.length ? start + 1 : 0;

  return (
    <DataTable
      data={list.rows}
      columns={columns}
      noun="applications"
      aria-label="Applications"
      getRowId={(row) => row.id ?? ""}
      emptyMessage={filtered || list.page > 1 ? "No applications found." : "No applications yet."}
      externalFiltersActive={filtered || params.sort !== "created_at" || params.dir !== "desc"}
      onClearFilters={() => {
        setSearch("");
        router.push(applicationListHref(params, {
          q: null,
          job: null,
          status: null,
          recommendation: null,
          knockout: null,
          sort: "created_at",
          dir: "desc",
        }), { scroll: false });
      }}
      filters={() => (
        <>
          <Input
            placeholder="Applicant Name"
            aria-label="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[200px] shrink-0 text-sm"
          />
          <FilterSelect
            value={params.job}
            onChange={(job) => navigate({ job })}
            allLabel="All Jobs"
            options={list.jobs.map((job) => ({ value: job.id, label: job.title }))}
            label="Filter by job"
          />
          <FilterSelect
            value={params.status}
            onChange={(status) => navigate({ status: status as ApplicationListParams["status"] })}
            allLabel="All Statuses"
            options={[...APPLICATION_STATUSES]}
            label="Filter by status"
          />
          <FilterSelect
            value={params.recommendation}
            onChange={(recommendation) =>
              navigate({ recommendation: recommendation as ApplicationListParams["recommendation"] })
            }
            allLabel="All recommendations"
            options={recommendationOptions}
            label="Filter by recommendation"
            className="w-[190px]"
          />
          <FilterSelect
            value={params.knockout}
            onChange={(knockout) => navigate({ knockout: knockout as ApplicationListParams["knockout"] })}
            allLabel="All requirements"
            options={knockoutOptions}
            label="Filter by requirements"
            className="w-[200px]"
          />
        </>
      )}
      footer={
        <DataTableFooter
          summary={`Showing ${formatCount(shownFrom)}–${formatCount(start + list.rows.length)} of ${formatCount(list.total)} applications`}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={list.page <= 1}
            onClick={() => navigate({ page: list.page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={list.page >= lastPage}
            onClick={() => navigate({ page: list.page + 1 })}
          >
            Next
          </Button>
        </DataTableFooter>
      }
    />
  );
}
