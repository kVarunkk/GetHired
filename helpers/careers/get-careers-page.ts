import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import type { Database } from "@/utils/types/database.types";
import { readLinks, readSections, type CareersLinks, type CareersSection } from "./page-schema";
import type { CareersJob } from "./search-company-jobs";
import { careersCompanyTag, careersSlugTag } from "./cache-tags";

// CP-SEC-001 / CP-CON-001: the public careers page reads through the anon
// client and two RPCs that return public columns only, cached per slug and
// per company and revalidated on careers edits and job changes.

export type CareersPage = {
  id: string;
  slug: string;
  published: boolean;
  name: string;
  tagLine: string | null;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  headquarters: string | null;
  companySize: string | null;
  industry: string | null;
  accentColor: string | null;
  coverUrl: string | null;
  sections: CareersSection[];
  links: CareersLinks;
};

export type CareersPageResult = { page: CareersPage } | { redirect: string } | null;


const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function toCareersPage(raw: unknown): CareersPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.slug !== "string") return null;
  return {
    id: r.id,
    slug: r.slug,
    published: r.published === true,
    name: text(r.name) ?? "This company",
    tagLine: text(r.tag_line),
    description: text(r.description),
    logoUrl: text(r.logo_url),
    website: text(r.website),
    headquarters: text(r.headquarters),
    companySize: text(r.company_size),
    industry: text(r.industry),
    accentColor: typeof r.accent_color === "string" && /^#[0-9a-f]{6}$/.test(r.accent_color) ? r.accent_color : null,
    coverUrl: typeof r.cover_url === "string" && r.cover_url.startsWith("https://") ? r.cover_url : null,
    sections: readSections(r.sections),
    links: readLinks(r.links),
  };
}

export function toCareersJobs(raw: unknown): CareersJob[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((j) => {
    if (!j || typeof j !== "object") return [];
    const r = j as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.all_jobs_id !== "string" || typeof r.title !== "string") return [];
    return [
      {
        id: r.id,
        allJobsId: r.all_jobs_id,
        title: r.title,
        description: typeof r.description === "string" ? r.description : "",
        locations: Array.isArray(r.location) ? r.location.filter((l): l is string => typeof l === "string") : [],
        jobType: text(r.job_type),
        department: text(r.department),
        workplaceType: r.workplace_type === "onsite" || r.workplace_type === "hybrid" || r.workplace_type === "remote" ? r.workplace_type : null,
        salaryCurrency: text(r.salary_currency),
        salaryRange: text(r.salary_range),
        minSalary: typeof r.min_salary === "number" ? r.min_salary : null,
        maxSalary: typeof r.max_salary === "number" ? r.max_salary : null,
        minExperience: typeof r.min_experience === "number" ? r.min_experience : null,
        maxExperience: typeof r.max_experience === "number" ? r.max_experience : null,
        experience: text(r.experience),
        createdAt: typeof r.created_at === "string" ? r.created_at : "",
      },
    ];
  });
}

async function loadPage(slug: string): Promise<CareersPageResult> {
  const { data, error } = await createPublicClient().rpc("get_careers_page", { p_slug: slug });
  if (error) throw new Error(`get_careers_page failed: ${error.message}`);
  if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as { redirect?: unknown }).redirect === "string") {
    return { redirect: (data as { redirect: string }).redirect };
  }
  const page = toCareersPage(data);
  return page ? { page } : null;
}

/** A published careers page, a redirect for a retired slug, or null (CP-REQ-002/008). */
export function getCareersPage(slug: string): Promise<CareersPageResult> {
  const key = slug.toLowerCase();
  return unstable_cache(() => loadPage(key), ["careers-page", key], {
    tags: [careersSlugTag(key)],
    revalidate: 3600,
  })();
}

/** The active jobs of a published page (CP-REQ-006). */
export function getCareersJobs(page: Pick<CareersPage, "id" | "slug">): Promise<CareersJob[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await createPublicClient().rpc("get_careers_jobs", { p_slug: page.slug });
      if (error) throw new Error(`get_careers_jobs failed: ${error.message}`);
      return toCareersJobs(data);
    },
    ["careers-jobs", page.id, page.slug],
    { tags: [careersCompanyTag(page.id), careersSlugTag(page.slug)], revalidate: 3600 },
  )();
}

/**
 * The session member's own page and jobs, published or not, for the preview
 * (CP-REQ-008). Uncached: it runs with the user's client.
 */
export async function getMyCareersPreview(
  supabase: SupabaseClient<Database>,
): Promise<{ page: CareersPage; jobs: CareersJob[] } | null> {
  const [{ data: page }, { data: jobs }] = await Promise.all([
    supabase.rpc("get_my_careers_page"),
    supabase.rpc("get_careers_jobs", { p_slug: "", p_preview: true }),
  ]);
  const parsed = toCareersPage(page);
  return parsed ? { page: parsed, jobs: toCareersJobs(jobs) } : null;
}
