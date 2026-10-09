import { createPublicClient } from "@/lib/supabase/public";
import {
  getSitemapData,
  SITEMAP_PAGE_SIZE,
  SITEMAP_URL_LIMIT,
} from "@/helpers/seo/sitemap-data";
import { MetadataRoute } from "next";

export const revalidate = 86400;

const SITE_URL = "https://gethired.devhub.co.in";

export async function generateSitemaps() {
  const { jobCount, staticPaths, locationSlugs } = await getSitemapData();
  const totalUrls = jobCount + staticPaths.length + locationSlugs.length;
  const sitemapCount = Math.ceil(totalUrls / SITEMAP_URL_LIMIT);

  return Array.from({ length: Math.max(sitemapCount, 1) }, (_, id) => ({ id }));
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  const { jobCount, staticPaths, locationSlugs } = await getSitemapData();
  const staticUrls = [
    ...staticPaths.map((path) => ({ url: `${SITE_URL}${path}` })),
    ...locationSlugs.map((slug) => ({
      url: `${SITE_URL}/remote-jobs/${encodeURIComponent(slug)}`,
    })),
  ];

  const start = id * SITEMAP_URL_LIMIT;
  const end = start + SITEMAP_URL_LIMIT;
  const entries: MetadataRoute.Sitemap = staticUrls.slice(start, end);
  const firstJobIndex = Math.max(0, start - staticUrls.length);
  const lastJobIndex = Math.min(jobCount, end - staticUrls.length);

  if (firstJobIndex < lastJobIndex) {
    const supabase = createPublicClient();

    for (
      let offset = firstJobIndex;
      offset < lastJobIndex;
      offset += SITEMAP_PAGE_SIZE
    ) {
      const pageEnd = Math.min(offset + SITEMAP_PAGE_SIZE, lastJobIndex);
      const { data: jobs, error } = await supabase
        .from("all_jobs")
        .select("id, created_at, updated_at")
        .eq("status", "active")
        .not("job_name", "is", null)
        .neq("job_name", "")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, pageEnd - 1);

      if (error) {
        throw new Error(`Failed to fetch sitemap jobs: ${error.message}`);
      }

      entries.push(
        ...jobs.map((job) => ({
          url: `${SITE_URL}/jobs/${job.id}`,
          lastModified: job.updated_at ?? job.created_at,
        })),
      );
    }
  }

  return entries;
}
