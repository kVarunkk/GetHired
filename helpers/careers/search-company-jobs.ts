// CP-REQ-005 / CP-GUD-002: search and filters for one company's careers jobs,
// shared by the page, /api/careers/[slug]/jobs and any later embed. A
// company's active jobs are few, so they're loaded once (cached) and
// filtered here. Client-safe: the jobs list syncs its filters with it.

export const CAREERS_PAGE_SIZE = 20;
export const OTHER_DEPARTMENT = "Other";

export type WorkplaceType = "onsite" | "hybrid" | "remote";
export const WORKPLACE_LABELS: Record<WorkplaceType, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };

export type CareersJob = {
  id: string;
  allJobsId: string;
  title: string;
  description: string;
  locations: string[];
  jobType: string | null;
  department: string | null;
  workplaceType: WorkplaceType | null;
  salaryCurrency: string | null;
  salaryRange: string | null;
  minSalary: number | null;
  maxSalary: number | null;
  minExperience: number | null;
  maxExperience: number | null;
  experience: string | null;
  createdAt: string;
};

export type CareersSort = "newest" | "title";

export type CareersFilters = {
  q: string;
  locations: string[];
  jobTypes: string[];
  departments: string[];
  workplaces: WorkplaceType[];
  /** Jobs paying at least this much (their max, or min without a max). */
  minSalary: number | null;
  /** Years of experience the candidate has: jobs whose range includes it. */
  experience: number | null;
  sort: CareersSort;
  page: number;
};

export type CareersSearchResult = {
  jobs: CareersJob[];
  total: number;
  page: number;
  hasMore: boolean;
  departments: { name: string; count: number }[];
  options: { locations: string[]; jobTypes: string[]; departments: string[]; workplaces: WorkplaceType[] };
};

const WORKPLACES: WorkplaceType[] = ["onsite", "hybrid", "remote"];
const list = (params: URLSearchParams, key: string, max = 20) =>
  [...new Set(params.getAll(key).map((v) => v.trim()).filter((v) => v && v.length <= 100))].slice(0, max);
const positive = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function parseCareersFilters(params: URLSearchParams): CareersFilters {
  const page = Math.floor(Number(params.get("page")));
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    locations: list(params, "location"),
    jobTypes: list(params, "jobType"),
    departments: list(params, "department"),
    workplaces: list(params, "workplace").filter((w): w is WorkplaceType => (WORKPLACES as string[]).includes(w)),
    minSalary: positive(params.get("minSalary")),
    experience: positive(params.get("experience")),
    sort: params.get("sort") === "title" ? "title" : "newest",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1000) : 1,
  };
}

/** The filters as a query string, leaving defaults out, for shareable URLs. */
export function serializeCareersFilters(filters: CareersFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.locations.forEach((v) => params.append("location", v));
  filters.jobTypes.forEach((v) => params.append("jobType", v));
  filters.departments.forEach((v) => params.append("department", v));
  filters.workplaces.forEach((v) => params.append("workplace", v));
  if (filters.minSalary !== null) params.set("minSalary", String(filters.minSalary));
  if (filters.experience !== null) params.set("experience", String(filters.experience));
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export function searchCompanyJobs(jobs: CareersJob[], filters: CareersFilters): CareersSearchResult {
  const q = filters.q.toLowerCase();
  const matches = jobs.filter((job) => {
    if (q && !job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
    if (filters.locations.length && !job.locations.some((l) => filters.locations.includes(l))) return false;
    if (filters.jobTypes.length && (!job.jobType || !filters.jobTypes.includes(job.jobType))) return false;
    if (filters.departments.length && !filters.departments.includes(job.department ?? OTHER_DEPARTMENT)) return false;
    if (filters.workplaces.length && (!job.workplaceType || !filters.workplaces.includes(job.workplaceType))) return false;
    if (filters.minSalary !== null) {
      const top = job.maxSalary || job.minSalary;
      if (!top || top < filters.minSalary) return false;
    }
    if (filters.experience !== null) {
      if (job.minExperience !== null && job.minExperience > filters.experience) return false;
      if (job.maxExperience && job.maxExperience < filters.experience) return false;
    }
    return true;
  });

  matches.sort((a, b) =>
    filters.sort === "title" ? a.title.localeCompare(b.title) : b.createdAt.localeCompare(a.createdAt),
  );

  const counts = new Map<string, number>();
  for (const job of matches) {
    const name = job.department ?? OTHER_DEPARTMENT;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const departments = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === OTHER_DEPARTMENT ? 1 : b.name === OTHER_DEPARTMENT ? -1 : b.count - a.count || a.name.localeCompare(b.name),
    );

  const start = (filters.page - 1) * CAREERS_PAGE_SIZE;
  return {
    jobs: matches.slice(start, start + CAREERS_PAGE_SIZE),
    total: matches.length,
    page: filters.page,
    hasMore: start + CAREERS_PAGE_SIZE < matches.length,
    departments,
    options: {
      locations: sorted(jobs.flatMap((j) => j.locations)),
      jobTypes: sorted(jobs.flatMap((j) => (j.jobType ? [j.jobType] : []))),
      departments: sorted(jobs.flatMap((j) => (j.department ? [j.department] : []))),
      workplaces: WORKPLACES.filter((w) => jobs.some((j) => j.workplaceType === w)),
    },
  };
}

/** A job as the list shows it: a short snippet instead of the full description. */
export type CareersJobView = Omit<CareersJob, "description"> & { snippet: string };
export type CareersSearchView = Omit<CareersSearchResult, "jobs"> & { jobs: CareersJobView[] };

const SNIPPET_CHARS = 240;

export function toJobView({ description, ...job }: CareersJob): CareersJobView {
  return { ...job, snippet: description.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS) };
}

export function toSearchView(result: CareersSearchResult): CareersSearchView {
  return { ...result, jobs: result.jobs.map(toJobView) };
}
