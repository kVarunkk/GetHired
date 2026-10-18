"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OTHER_DEPARTMENT,
  WORKPLACE_LABELS,
  serializeCareersFilters,
  type CareersFilters,
  type CareersJobView,
  type CareersSearchView,
  type WorkplaceType,
} from "@/helpers/careers/search-company-jobs";

// CP-REQ-005: the careers page's jobs, modelled on /jobs. Filters live in the
// URL (shareable); changing one re-renders the page on the server. "Load
// more" fetches the next page from /api/careers/[slug]/jobs.

// Radix Select items can't have an empty value, so "any" gets a sentinel.
const ANY = "__any__";

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function JobRow({ job, href }: { job: CareersJobView; href: string }) {
  const meta = [
    job.locations.length ? job.locations.map(titleCase).join(", ") : null,
    job.workplaceType ? WORKPLACE_LABELS[job.workplaceType] : null,
    job.jobType,
    job.salaryRange,
  ].filter(Boolean);
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
      >
        <span className="font-medium text-foreground">{job.title}</span>
        {meta.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {meta.join(" · ")}
          </span>
        )}
      </Link>
    </li>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Select
      value={value || ANY}
      onValueChange={(v) => onChange(v === ANY ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}: any</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function CareersJobs({
  slug,
  initial,
  filters,
  jobBasePath,
  refTag,
  groupByDepartment = true,
  preview = false,
}: {
  slug: string;
  initial: CareersSearchView;
  filters: CareersFilters;
  /** Job links are `${jobBasePath}/<all_jobs id>`, e.g. /careers/acme/jobs. */
  jobBasePath: string;
  /** CP-REQ-013: a `?ref=` tag carried to the job page and the application. */
  refTag?: string | null;
  groupByDepartment?: boolean;
  /** The editor's preview: no filters, nothing is fetched. */
  preview?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [jobs, setJobs] = useState(initial.jobs);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(filters.q);

  // A new server render (filters changed) starts the list again.
  useEffect(() => {
    setJobs(initial.jobs);
    setPage(initial.page);
    setHasMore(initial.hasMore);
  }, [initial]);

  const apply = (next: Partial<CareersFilters>) => {
    const query = serializeCareersFilters({ ...filters, ...next, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const query = serializeCareersFilters({ ...filters, page: page + 1 });
      const res = await fetch(
        `/api/careers/${encodeURIComponent(slug)}/jobs?${query}`,
      );
      if (!res.ok) throw new Error();
      const next = (await res.json()) as CareersSearchView;
      setJobs((current) => [...current, ...next.jobs]);
      setPage(next.page);
      setHasMore(next.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const single = (values: string[]) => values[0] ?? "";
  const groups = groupByDepartment
    ? initial.departments
        .map((d) => ({
          name: d.name,
          count: d.count,
          jobs: jobs.filter(
            (j) => (j.department ?? OTHER_DEPARTMENT) === d.name,
          ),
        }))
        .filter((g) => g.jobs.length > 0)
    : [{ name: null as string | null, count: initial.total, jobs }];
  const showGroupHeadings = groupByDepartment && groups.length > 1;

  return (
    <section aria-labelledby="careers-jobs" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="careers-jobs" className="text-lg font-semibold tracking-tight">
          Open roles
        </h2>
        <span className="text-sm text-muted-foreground">
          {initial.total} {initial.total === 1 ? "role" : "roles"}
        </span>
      </div>

      {!preview && (
        <form
          role="search"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ q: q.trim() });
          }}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search roles"
              placeholder="Search roles"
              className="pl-9"
              value={q}
              disabled={preview}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Department"
              value={single(filters.departments)}
              options={initial.options.departments.map((d) => ({
                value: d,
                label: d,
              }))}
              onChange={(v) => apply({ departments: v ? [v] : [] })}
            />
            <FilterSelect
              label="Workplace"
              value={single(filters.workplaces)}
              options={initial.options.workplaces.map((w) => ({
                value: w,
                label: WORKPLACE_LABELS[w],
              }))}
              onChange={(v) =>
                apply({ workplaces: v ? [v as WorkplaceType] : [] })
              }
            />
            <FilterSelect
              label="Location"
              value={single(filters.locations)}
              options={initial.options.locations.map((l) => ({
                value: l,
                label: titleCase(l),
              }))}
              onChange={(v) => apply({ locations: v ? [v] : [] })}
            />
            <FilterSelect
              label="Job type"
              value={single(filters.jobTypes)}
              options={initial.options.jobTypes.map((t) => ({
                value: t,
                label: t,
              }))}
              onChange={(v) => apply({ jobTypes: v ? [v] : [] })}
            />
            <Select
              value={filters.sort}
              onValueChange={(v) =>
                apply({ sort: v === "title" ? "title" : "newest" })
              }
            >
              <SelectTrigger aria-label="Sort" className="w-auto min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="title">Title A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>
      )}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <Briefcase className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="font-medium">No open roles match</p>
          <p className="text-sm text-muted-foreground">
            Try fewer filters, or check back soon.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.name ?? "all"} className="flex flex-col gap-2">
              {showGroupHeadings && (
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group.name} · {group.count}
                </h3>
              )}
              <ul
                className="divide-y rounded-xl border"
                aria-label={group.name ?? "Roles"}
              >
                {group.jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    href={`${jobBasePath}/${job.allJobsId}${refTag ? `?ref=${encodeURIComponent(refTag)}` : ""}`}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {hasMore && !preview && (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </section>
  );
}
