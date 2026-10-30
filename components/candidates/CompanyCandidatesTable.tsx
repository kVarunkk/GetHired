"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { BriefcaseBusiness, Plus, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { deleteCandidatesAction } from "@/app/actions/candidates/delete-candidates";
import DataTable, { DataTableFooter, FilterSelect } from "@/components/DataTable";
import ConfirmDialog from "@/components/ConfirmDialog";
import AddToListMenu from "@/components/pipeline/AddToListMenu";
import AddCandidatesToJobDialog from "@/components/candidates/AddCandidatesToJobDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { candidateImportPath, newCandidatePath } from "@/helpers/candidates/paths";
import { CANDIDATE_ADDED_DAYS } from "@/helpers/candidates/candidate-added-days";
import { POOL_MATCH_LABEL } from "@/helpers/candidates/pool-match";
import type {
  CandidateFilters,
  CompanyCandidateList,
  CompanyCandidateListItem,
} from "@/helpers/candidates/list-candidates";
import { formatDate } from "@/utils/date";

type UrlState = {
  q: string | null;
  tag: string | null;
  batch: string | null;
  inJob: string | null;
  loc: string | null;
  resume: string | null;
  email: string | null;
  added: string | null;
  matchJob: string | null;
  page: number;
};
const URL_KEYS = ["q", "tag", "batch", "inJob", "loc", "resume", "email", "added", "matchJob", "page"] as const;
const NO_FILTERS = {
  q: null,
  tag: null,
  batch: null,
  inJob: null,
  loc: null,
  resume: null,
  email: null,
  added: null,
  matchJob: null,
};

const NO_EMAIL = "Add an email first";

/**
 * The Candidates page (BI-REQ-003): the company's own candidates, paged and
 * filtered by the server through the URL. Also a talent list's company
 * candidates (`inList`, BI-REQ-006), where adding and importing aren't offered.
 */
export default function CompanyCandidatesTable({
  list,
  filters,
  options,
  jobs,
  canCreate,
  canDelete,
  canManageLists,
  matchJobs = null,
  inList = false,
}: {
  list: CompanyCandidateList;
  filters: CandidateFilters;
  options: { tags: string[]; batches: { id: string; fileName: string }[] };
  /** Jobs the member can import into (applicants.import). Empty hides "Add to a job". */
  jobs: { id: string; title: string }[];
  /** "Add candidate" and "Import". */
  canCreate: boolean;
  /** Needs applicants.import for every job. */
  canDelete: boolean;
  canManageLists: boolean;
  /** The "Match to job" filter's jobs (jobs.view); null hides it (CP-REQ-071/072). */
  matchJobs?: { id: string; title: string }[] | null;
  inList?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [deleting, setDeleting] = useState<CompanyCandidateListItem[] | null>(null);
  const [addingToJob, setAddingToJob] = useState<string[] | null>(null);
  const [search, setSearch] = useState(filters.q ?? "");
  const debouncedSearch = useDebounce(search.trim(), 400);
  const [location, setLocation] = useState(filters.loc ?? "");
  const debouncedLocation = useDebounce(location.trim(), 400);

  const navigate = (next: Partial<UrlState>) => {
    const current: UrlState = {
      q: filters.q,
      tag: filters.tag,
      batch: filters.batchId,
      inJob: filters.inJob,
      loc: filters.loc,
      resume: filters.resume,
      email: filters.email,
      added: filters.addedDays ? String(filters.addedDays) : null,
      matchJob: filters.matchJob,
      page: filters.page,
      // A filter change starts from the first page.
      ...(next.page === undefined ? { page: 1 } : {}),
      ...next,
    };
    const params = new URLSearchParams(searchParams.toString());
    for (const key of URL_KEYS) {
      const value = current[key];
      params.delete(key);
      if (key === "page" ? value !== 1 : value) params.set(key, String(value));
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (debouncedSearch !== (filters.q ?? "")) navigate({ q: debouncedSearch || null });
    // Only a new search term navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (debouncedLocation !== (filters.loc ?? "")) navigate({ loc: debouncedLocation || null });
    // Only a new location navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLocation]);

  // The list comes sorted by similarity while matching (CP-REQ-071).
  const matching = Boolean(filters.matchJob);
  const columns: ColumnDef<CompanyCandidateListItem>[] = useMemo(
    () => [
      ...(canDelete
        ? [
            {
              id: "select",
              header: ({ table }) => (
                <Checkbox
                  aria-label="Select all"
                  checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")}
                  onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  aria-label={`Select ${row.original.name}`}
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                />
              ),
              meta: { className: "w-8", headerClassName: "w-8" },
            } satisfies ColumnDef<CompanyCandidateListItem>,
          ]
        : []),
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="max-w-xs">
            <Link
              href={`/company/candidates/${row.original.id}`}
              className="block truncate font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.email && (
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            )}
          </div>
        ),
      },
      ...(matching
        ? [
            {
              id: "similarity",
              header: POOL_MATCH_LABEL,
              cell: ({ row }) => <div className="text-sm font-medium">{row.original.score ?? "—"}</div>,
            } satisfies ColumnDef<CompanyCandidateListItem>,
          ]
        : []),
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => <div className="max-w-[14rem] truncate text-sm">{row.original.title ?? "—"}</div>,
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => <div className="text-sm capitalize">{row.original.location ?? "—"}</div>,
      },
      {
        id: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <div className="flex max-w-[14rem] flex-wrap gap-1">
            {row.original.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "batch",
        header: "Source",
        cell: ({ row }) => (
          <div className="max-w-[10rem] truncate text-sm text-muted-foreground">
            {row.original.batch?.fileName ?? (row.original.batch ? "Added by hand" : "—")}
          </div>
        ),
      },
      {
        id: "jobs",
        header: "Jobs",
        cell: ({ row }) => <div className="text-sm">{row.original.jobCount}</div>,
      },
      {
        id: "added",
        header: "Added",
        cell: ({ row }) => <div className="text-sm">{formatDate(row.original.createdAt) || "—"}</div>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const candidate = row.original;
          return (
            <div className="flex items-center gap-1">
              {jobs.length > 0 && (
                // A disabled button gets no hover, so the reason sits on its wrapper.
                <span title={candidate.email ? "Add to a job" : NO_EMAIL}>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Add ${candidate.name} to a job`}
                    disabled={!candidate.email}
                    onClick={() => setAddingToJob([candidate.id])}
                  >
                    <BriefcaseBusiness className="h-4 w-4" />
                  </Button>
                </span>
              )}
              {canManageLists && <AddToListMenu companyCandidateId={candidate.id} className="h-8" />}
              {canDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${candidate.name}`}
                  title="Delete"
                  onClick={() => setDeleting([candidate])}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [canDelete, canManageLists, jobs.length, matching],
  );

  const selected = list.items.filter((item) => rowSelection[item.id]);
  const filtered = Boolean(
    filters.q ||
      filters.tag ||
      filters.batchId ||
      filters.inJob ||
      filters.loc ||
      filters.resume ||
      filters.email ||
      filters.addedDays ||
      filters.matchJob,
  );
  const start = (list.page - 1) * list.pageSize;
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));

  const confirmDelete = async () => {
    if (!deleting) return;
    const result = await deleteCandidatesAction({ candidateIds: deleting.map((c) => c.id) });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.deleted === 1 ? "Candidate deleted." : `${result.deleted} candidates deleted.`);
    setRowSelection({});
    router.refresh();
  };

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        noun="candidates"
        aria-label="Candidates"
        getRowId={(row) => row.id}
        enableRowSelection={canDelete}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        emptyMessage={
          filtered || list.page > 1 || inList ? (
            "No candidates found."
          ) : canCreate ? (
            "No candidates yet. Add someone you're already talking to, or import a spreadsheet."
          ) : (
            "No candidates yet."
          )
        }
        externalFiltersActive={filtered}
        onClearFilters={() => {
          setSearch("");
          setLocation("");
          navigate(NO_FILTERS);
        }}
        filters={() => (
          <>
            <Input
              placeholder="Name, email, title or skill"
              aria-label="Search candidates"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[200px] shrink-0 text-sm"
            />
            <FilterSelect
              value={filters.tag}
              onChange={(tag) => navigate({ tag })}
              allLabel="All Tags"
              options={options.tags}
              label="Filter by tag"
            />
            <FilterSelect
              value={filters.batchId}
              onChange={(batch) => navigate({ batch })}
              allLabel="All Sources"
              options={options.batches.map((b) => ({ value: b.id, label: b.fileName }))}
              label="Filter by import file"
            />
            <FilterSelect
              value={filters.inJob}
              onChange={(inJob) => navigate({ inJob })}
              allLabel="In a job or not"
              options={[
                { value: "yes", label: "In a job" },
                { value: "no", label: "In no job" },
              ]}
              label="Filter by jobs"
            />
            <Input
              placeholder="Location"
              aria-label="Filter by location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-[160px] shrink-0 text-sm"
            />
            <FilterSelect
              value={filters.resume}
              onChange={(resume) => navigate({ resume })}
              allLabel="Resume or not"
              options={[
                { value: "has", label: "Has a resume" },
                { value: "none", label: "No resume" },
              ]}
              label="Filter by resume"
            />
            <FilterSelect
              value={filters.email}
              onChange={(email) => navigate({ email })}
              allLabel="Email or not"
              options={[
                { value: "has", label: "Has an email" },
                { value: "none", label: "No email" },
              ]}
              label="Filter by email"
            />
            <FilterSelect
              value={filters.addedDays ? String(filters.addedDays) : null}
              onChange={(added) => navigate({ added })}
              allLabel="Added any time"
              options={CANDIDATE_ADDED_DAYS.map((days) => ({ value: String(days), label: `Last ${days} days` }))}
              label="Filter by date added"
            />
            {matchJobs && (
              <FilterSelect
                value={filters.matchJob}
                onChange={(matchJob) => navigate({ matchJob })}
                allLabel="Match to job"
                options={matchJobs.map((job) => ({ value: job.id, label: job.title }))}
                label="Match to job"
              />
            )}
          </>
        )}
        actions={
          <>
            {selected.length > 0 && canDelete && (
              <Button variant="outline" onClick={() => setDeleting(selected)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete {selected.length}
              </Button>
            )}
            {canCreate && !inList && (
              <>
                <Button asChild variant="outline">
                  <Link href={candidateImportPath()}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import
                  </Link>
                </Button>
                <Button asChild variant="brand">
                  <Link href={newCandidatePath()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add candidate
                  </Link>
                </Button>
              </>
            )}
          </>
        }
        footer={
          <DataTableFooter
            summary={`Showing ${list.items.length ? start + 1 : 0}-${start + list.items.length} of ${list.total} candidates`}
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting?.length === 1 ? `Delete ${deleting[0].name}?` : `Delete ${deleting?.length ?? 0} candidates?`
        }
        description="Their imported applications, notes and list memberships go too. If they connected a GetHired account, they keep their applications. This can't be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />

      <AddCandidatesToJobDialog
        open={addingToJob !== null}
        onOpenChange={(open) => !open && setAddingToJob(null)}
        candidateIds={addingToJob ?? []}
        jobs={jobs}
      />
    </>
  );
}
