import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkEligibility } from "@/helpers/distribution/eligibility";
import { jobPageUrl } from "@/helpers/distribution/index-ping";
import type { FeedJob, FeedJobType } from "./feed-job";
import { cityOf, cleanFeedTitle, indianState, isoCurrency, logoTypeOf, NO_SALARY_TEXT, salaryBound, textToHtml, type LogoType } from "./normalize";
import type { FeedPlatform } from "./build";
import { endOfDayIn } from "@/helpers/companies/time-zone";

/**
 * MPT-020: the jobs of one feed. Reads public columns only (never the form
 * rules, notes or contact details), for companies that turned the channel on,
 * leaving out opted-out and ineligible jobs. A board that hasn't approved
 * GetHired yet still gets the jobs, since it reviews the feed to decide.
 */

export type FeedJobRow = {
  job_id: string | null;
  title: string;
  description: string | null;
  location: string[];
  workplace_type: "onsite" | "hybrid" | "remote" | null;
  job_type: "Fulltime" | "Intern" | "Contract";
  department: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_currency: string | null;
  salary_range: string | null;
  min_experience: number | null;
  max_experience: number | null;
  created_at: string;
  updated_at: string;
  closes_at?: string | null;
  company_info: {
    name: string | null;
    logo_url: string | null;
    headquarters?: string | null;
    time_zone?: string | null;
  } | null;
};

const JOB_TYPES: Record<FeedJobRow["job_type"], FeedJobType> = {
  Fulltime: "full_time",
  Intern: "internship",
  Contract: "contract",
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Location entries that describe the workplace rather than a place. */
const NOT_A_PLACE = /^(remote|anywhere|worldwide|work from home|wfh)$/i;

/** GetHired jobs are mostly India (spec 10.2); the country is fixed until jobs carry one. */
export function toFeedJob(row: FeedJobRow, logoTypes: ReadonlyMap<string, LogoType | null> = new Map()): FeedJob | null {
  if (!row.job_id) return null;
  const remote = row.workplace_type === "remote";
  // "Remote" is the workplace, not a place: boards that need a city with a
  // state would drop the job. Prefer the first Indian city, since the
  // country is India.
  const places = row.location.map((l) => l.trim()).filter((l) => l.length > 0 && !NOT_A_PLACE.test(l));
  const first = places.find((l) => indianState(l)) ?? places[0];
  const min = salaryBound(row.min_salary);
  const max = salaryBound(row.max_salary);
  const text = row.salary_range && !NO_SALARY_TEXT.test(row.salary_range) ? row.salary_range.trim() : null;
  const logoUrl = row.company_info?.logo_url ?? null;

  const check = checkEligibility({
    title: row.title,
    description: row.description,
    locations: row.location,
    remote,
    applyUrl: jobPageUrl(row.job_id),
    companyName: row.company_info?.name,
    companyLogoUrl: row.company_info?.logo_url,
  });
  if (!check.eligible) return null;

  return {
    id: row.job_id,
    title: cleanFeedTitle(row.title, row.location),
    descriptionHtml: textToHtml(row.description!),
    city: first ? titleCase(first) : "",
    state: indianState(first),
    locations: [...new Set(places.map(titleCase))],
    country: "India",
    countryCode: "IN",
    workplace: row.workplace_type ?? "onsite",
    jobType: JOB_TYPES[row.job_type],
    companyName: row.company_info!.name!.trim(),
    companyLogoUrl: logoUrl,
    companyCity: cityOf(row.company_info?.headquarters),
    companyLogoType: logoUrl ? (logoTypes.get(logoUrl) ?? null) : null,
    salary: min != null || max != null || text ? { min, max, currency: isoCurrency(row.salary_currency), text } : null,
    experience:
      row.min_experience != null || row.max_experience != null
        ? { min: row.min_experience, max: row.max_experience }
        : null,
    category: row.department,
    postedAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    closesOn: row.closes_at ?? null,
    expiresAt: expiresAtOf(row),
  };
}

/** JL-REQ-016: the end of the closing date in the company's time zone. */
function expiresAtOf(row: FeedJobRow): Date | null {
  if (!row.closes_at) return null;
  const iso = endOfDayIn(row.closes_at, row.company_info?.time_zone);
  return iso ? new Date(iso) : null;
}

/** Supabase returns at most 1000 rows a query, so every read pages or chunks. */
export const PAGE_SIZE = 1000;
/** Ids per `.in()` list, to keep the request URL short. */
export const ID_CHUNK = 200;

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** A logo's type, from a HEAD request. Null when it can't be read. */
export async function headLogoType(url: string): Promise<LogoType | null> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok ? logoTypeOf(res.headers.get("content-type")) : null;
  } catch {
    return null;
  }
}

/** Jooble and Talent.com take only some image formats, and logo URLs carry no extension. */
const PLATFORMS_WITH_LOGOS: readonly FeedPlatform[] = ["jooble", "talent"];
const LOGO_CONCURRENCY = 8;

async function resolveLogoTypes(urls: string[], resolve: (url: string) => Promise<LogoType | null>) {
  const types = new Map<string, LogoType | null>();
  for (let i = 0; i < urls.length; i += LOGO_CONCURRENCY) {
    const batch = urls.slice(i, i + LOGO_CONCURRENCY);
    const found = await Promise.all(batch.map(resolve));
    batch.forEach((url, k) => types.set(url, found[k]));
  }
  return types;
}

export async function loadFeedJobs(
  platform: FeedPlatform,
  { resolveLogoType = headLogoType }: { resolveLogoType?: (url: string) => Promise<LogoType | null> } = {},
): Promise<FeedJob[]> {
  const admin = createServiceRoleClient();

  const companyIds: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("company_channel_settings")
      .select("company_id")
      .eq("channel_key", platform)
      .eq("enabled", true)
      .order("company_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    companyIds.push(...(data ?? []).map((s) => s.company_id));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  if (companyIds.length === 0) return [];

  const rows: FeedJobRow[] = [];
  for (const ids of chunk(companyIds, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("job_postings")
        .select(
          "job_id, title, description, location, workplace_type, job_type, department, min_salary, max_salary, salary_currency, salary_range, min_experience, max_experience, created_at, updated_at, closes_at, company_info(name, logo_url, headquarters, time_zone)",
        )
        .eq("status", "active")
        // Link-only jobs never go into a feed (JL-REQ-025).
        .eq("visibility", "public")
        .in("company_id", ids)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as FeedJobRow[]));
      if ((data ?? []).length < PAGE_SIZE) break;
    }
  }

  const jobIds = rows.map((r) => r.job_id).filter((id): id is string => !!id);
  const out = new Set<string>();
  for (const ids of chunk(jobIds, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("job_channel_postings")
        .select("job_id")
        .eq("channel_key", platform)
        .eq("status", "opted_out")
        .in("job_id", ids)
        .order("job_id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      for (const o of data ?? []) out.add(o.job_id);
      if ((data ?? []).length < PAGE_SIZE) break;
    }
  }

  const kept = rows.filter((r) => r.job_id && !out.has(r.job_id));
  const logoUrls = PLATFORMS_WITH_LOGOS.includes(platform)
    ? [...new Set(kept.map((r) => r.company_info?.logo_url).filter((u): u is string => !!u))]
    : [];
  const logoTypes = await resolveLogoTypes(logoUrls, resolveLogoType);

  return kept.map((r) => toFeedJob(r, logoTypes)).filter((j): j is FeedJob => j !== null);
}
