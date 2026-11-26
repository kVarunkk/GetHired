import type { SearchJobsParams } from "@/helpers/jobs/search-jobs";
import type { AlertFilters } from "./filters";

const joined = (values: string[] | undefined) => (values?.length ? values.join("|") : null);
const numeric = (value: number | undefined) => (value === undefined ? null : String(value));

/** An alert's search, newest first: the email's jobs and the confirmation's sample. */
export function alertSearchParams(filters: AlertFilters) {
  return {
    jobTitleKeywords: joined(filters.jobTitleKeywords),
    location: joined(filters.location),
    jobType: joined(filters.jobType),
    platform: joined(filters.platform),
    companyName: joined(filters.companyName),
    minSalary: numeric(filters.minSalary),
    salaryCurrency: filters.salaryCurrency ?? null,
    minExperience: numeric(filters.minExperience),
    maxExperience: numeric(filters.maxExperience),
    sortBy: "created_at",
    sortOrder: "desc",
  } satisfies Partial<SearchJobsParams>;
}
