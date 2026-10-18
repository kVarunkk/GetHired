"use client";

import KnockoutBadge from "@/components/applications/KnockoutBadge";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatDate } from "@/utils/date";
import { ChevronRight, ArrowUpDown, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import DataTable, { FilterSelect, SelectFilter, SortableHeader, TextFilter } from "@/components/DataTable";
import type { StageOption } from "@/components/pipeline/StagePicker";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import MatchScoreBadge from "./matching/MatchScoreBadge";
import { TApplicationServer } from "@/utils/types/application.types";
import { TApplicationStatus } from "@/utils/types";
import { RECOMMENDATION_LABELS, type ScreeningRecommendation } from "@/helpers/matching/config";
import { isScreeningInProgress, type ScreeningStatus } from "@/helpers/matching/screening-view";
import { useEntitlementError } from "@/hooks/useEntitlementError";

interface ApplicantsTableProps {
  data: (TApplicationServer & { stage_id?: string | null })[];
  /** In one job's context: enables "Screen N unscreened". */
  jobPostId?: string;
  /** "fit" sorts by fit score, highest first. */
  defaultSort?: "fit";
  /**
   * The pipeline list (PL-TASK-004): the company's active stages. Adds a
   * selection checkbox per row, a Stage column and a stage filter.
   */
  stages?: StageOption[];
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  /** The member's monthly screening cap from their role, when capped (RP-REQ-044). */
  screeningCap?: { limit: number; remaining: number } | null;
  /** AF-REQ-008: the job's yes/no and single-choice questions, to filter by answer. */
  answerQuestions?: AnswerFilterQuestion[];
}

export type { AnswerFilterQuestion } from "@/helpers/applications/answer-filters";
import type { AnswerFilterQuestion } from "@/helpers/applications/answer-filters";

/** An answer as the filter compares it: yes/no become "yes"/"no". */
const answerKey = (value: unknown) => (value === true ? "yes" : value === false ? "no" : typeof value === "string" ? value : null);

/** Filter-only columns: the recommendation and knockout badges show elsewhere. */
const COLUMN_VISIBILITY = { recommendation: false, knockout: false };

type Row = TApplicationServer & {
  stage_id?: string | null;
  applicantName: string;
  jobTitle: string;
};

const applicationStatuses = [
  "submitted",
  "reviewed",
  "selected",
  "stand_by",
  "rejected",
];

const recommendationOptions = (Object.keys(RECOMMENDATION_LABELS) as ScreeningRecommendation[]).map((r) => ({
  value: r,
  label: RECOMMENDATION_LABELS[r],
}));
const knockoutOptions = [
  { value: "failed", label: "Didn't meet requirements" },
  { value: "passed", label: "Met requirements" },
];

/** Screenings the backfill route queues again: none, stale, failed, skipped. */
const needsScreening = (status: string | undefined) =>
  status === undefined || status === "stale" || status === "failed" || status === "skipped_quota";

export default function ApplicantsTable({
  data,
  jobPostId,
  defaultSort,
  stages,
  rowSelection = {},
  onRowSelectionChange,
  screeningCap = null,
  answerQuestions = [],
}: ApplicantsTableProps) {
  const router = useRouter();
  const { handle: handleEntitlement, dialog } = useEntitlementError();
  const [screening, setScreening] = useState(false);

  const jobTitles = useMemo(() => {
    const titles = data
      .map((item) => item.job_postings?.title)
      .filter(
        (title): title is string =>
          typeof title === "string" && title.length > 0,
      );
    return [...new Set(titles)];
  }, [data]);

  const [answerQuestionId, setAnswerQuestionId] = useState<string | null>(null);
  const [answerValue, setAnswerValue] = useState<string | null>(null);
  const answerQuestion = answerQuestions.find((q) => q.id === answerQuestionId) ?? null;

  const flatData = useMemo(() => {
    const rows = data.map((item) => ({
      ...item,
      applicantName: item.user_info?.full_name || "",
      jobTitle: item.job_postings?.title || "",
    }));
    if (!answerQuestionId || !answerValue) return rows;
    return rows.filter((row) => {
      const answers = row.answers_v2;
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
      return answerKey((answers as Record<string, unknown>)[answerQuestionId]) === answerValue;
    });
  }, [data, answerQuestionId, answerValue]);

  // Only jobs with knockout rules have failed rows worth filtering by.
  const hasKnockouts = useMemo(() => data.some((item) => item.application_knockouts?.failed), [data]);

  const unscreened = useMemo(
    () => data.filter((item) => needsScreening(item.application_screenings?.status)).length,
    [data],
  );

  const columns: ColumnDef<Row>[] = useMemo(() => {
    const stageName = new Map((stages ?? []).map((s) => [s.id, s.name]));
    const selectColumn: ColumnDef<Row> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all"
          checked={
            table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${row.original.applicantName || "applicant"}`}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableSorting: false,
    };
    const stageColumn: ColumnDef<Row> = {
      id: "stage",
      accessorFn: (row) => row.stage_id ?? undefined,
      header: "Stage",
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          {(row.original.stage_id && stageName.get(row.original.stage_id)) ?? "—"}
        </span>
      ),
      filterFn: "equals",
    };
    return [
      ...(stages ? [selectColumn] : []),
      {
        accessorKey: "applicantName",
        header: ({ column }) => (
          <SortableHeader column={column} label="Applicant Name" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="max-w-[14rem] truncate font-medium"
              title={row.original.applicantName || undefined}
            >
              {row.original.applicantName || "N/A"}
            </div>
            <KnockoutBadge knockout={row.original.application_knockouts} />
          </div>
        ),
        filterFn: "includesString",
      },
      {
        // AF-REQ-003: filter only; the badge sits next to the name.
        id: "knockout",
        accessorFn: (row) =>
          row.application_knockouts ? (row.application_knockouts.failed ? "failed" : "passed") : "none",
        filterFn: "equals",
      },
      {
        accessorKey: "jobTitle",
        header: ({ column }) => (
          <SortableHeader column={column} label="Job Title" />
        ),
        cell: ({ row }) => (
          <div className="max-w-[16rem] truncate text-sm" title={row.original.jobTitle}>
            <Link
              href={`/company/job-posts/${row.original.job_postings?.id}`}
              className="hover:underline underline underline-offset-4 sm:no-underline"
            >
              {row.original.jobTitle}
            </Link>
          </div>
        ),
        filterFn: "equals",
      },
      {
        id: "fit",
        // Unscored rows stay last in both directions.
        accessorFn: (row) => row.application_screenings?.fit_score ?? undefined,
        sortUndefined: "last",
        sortDescFirst: true,
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting()}>
            Fit
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => {
          const s = row.original.application_screenings;
          if (isScreeningInProgress(s?.status as ScreeningStatus | undefined)) {
            return (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Screening…
              </span>
            );
          }
          if (s?.fit_score !== null && s?.fit_score !== undefined) {
            return <MatchScoreBadge score={s.fit_score} className="whitespace-nowrap" />;
          }
          return <span className="text-muted-foreground">—</span>;
        },
      },
      {
        id: "recommendation",
        accessorFn: (row) => row.application_screenings?.recommendation ?? undefined,
        filterFn: "equals",
        enableHiding: true,
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <SortableHeader column={column} label="Status" />
        ),
        cell: ({ row }) => (
          <ApplicationStatusBadge
            status={row.original.status as TApplicationStatus}
          />
        ),
        filterFn: "equals",
      },
      ...(stages ? [stageColumn] : []),
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <SortableHeader column={column} label="Date Applied" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {formatDate(row.original.created_at)}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <Link href={`/company/applicants/${row.original.id}`}>
            <Button variant="ghost" size="sm">
              View Applicant
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        ),
      },
    ];
  }, [stages]);

  const screenUnscreened = async () => {
    if (!jobPostId) return;
    setScreening(true);
    try {
      const res = await fetch(`/api/company/job-posts/${jobPostId}/screen`, { method: "POST" });
      if (await handleEntitlement(res)) return;
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't queue the screenings. Please try again.");
        return;
      }
      const queued: number = body?.queued ?? 0;
      toast.success(`Queued ${queued} screening${queued === 1 ? "" : "s"}.`);
      router.refresh();
    } catch {
      toast.error("Couldn't queue the screenings. Please try again.");
    } finally {
      setScreening(false);
    }
  };

  return (
    <>
      <DataTable
        data={flatData}
        columns={columns}
        noun="applicants"
        initialSorting={defaultSort === "fit" ? [{ id: "fit", desc: true }] : []}
        columnVisibility={COLUMN_VISIBILITY}
        getRowId={(row) => row.id}
        enableRowSelection={!!stages}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        externalFiltersActive={Boolean(answerQuestionId && answerValue)}
        onClearFilters={() => {
          setAnswerQuestionId(null);
          setAnswerValue(null);
        }}
        filters={(table) => (
          <>
            <TextFilter table={table} column="applicantName" placeholder="Applicant Name" />
            <SelectFilter
              table={table}
              column="jobTitle"
              allLabel="All Titles"
              options={jobTitles}
              label="Filter by job title"
            />
            <SelectFilter
              table={table}
              column="status"
              allLabel="All Statuses"
              options={applicationStatuses}
              label="Filter by status"
            />
            <SelectFilter
              table={table}
              column="recommendation"
              allLabel="All recommendations"
              options={recommendationOptions}
              label="Filter by recommendation"
              className="w-[190px]"
            />
            {answerQuestions.length > 0 && (
              <>
                <FilterSelect
                  value={answerQuestionId}
                  onChange={(value) => {
                    setAnswerQuestionId(value);
                    setAnswerValue(null);
                  }}
                  allLabel="Any answers"
                  options={answerQuestions.map((q) => ({ value: q.id, label: q.label }))}
                  label="Filter by question"
                  className="w-[200px]"
                />
                {answerQuestion && (
                  <FilterSelect
                    value={answerValue}
                    onChange={setAnswerValue}
                    allLabel="Any answer"
                    options={answerQuestion.options}
                    label="Answer"
                    className="w-[160px]"
                  />
                )}
              </>
            )}
            {hasKnockouts && (
              <SelectFilter
                table={table}
                column="knockout"
                allLabel="All requirements"
                options={knockoutOptions}
                label="Filter by requirements"
                className="w-[200px]"
              />
            )}
            {stages && (
              <SelectFilter
                table={table}
                column="stage"
                allLabel="All stages"
                options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
                label="Filter by stage"
                className="w-[160px]"
              />
            )}
          </>
        )}
        actions={
          jobPostId &&
          unscreened > 0 && (
            <>
              {screeningCap && (
                <span className="text-xs text-muted-foreground">
                  {screeningCap.remaining} of your {screeningCap.limit} screenings left this month
                </span>
              )}
              <Button variant="brand" onClick={screenUnscreened} disabled={screening}>
                {screening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Screen {unscreened} unscreened
              </Button>
            </>
          )
        }
      />
      {dialog}
    </>
  );
}
