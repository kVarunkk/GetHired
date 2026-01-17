import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MetadataRoute } from "next";
// import { createClient } from "@/lib/supabase/server";

export const revalidate = 84600;

const SITE_URL = "https://gethired.devhub.co.in";
const LIMIT_PER_SITEMAP = 45000;

/**
 * 1. GENERATE SITEMAPS (The Indexer)
 */
export async function generateSitemaps() {
  const supabase = createServiceRoleClient();

  // Get Counts
  const { count: jobCount } = await supabase
    .from("all_jobs")
    .select("id", { count: "exact", head: true });
  // const { count: aliasCount } = await supabase
  //   .from("location_aliases")
  //   .select("id", { count: "exact", head: true });
  const { data: geoData } = await supabase
    .from("countries_and_cities")
    .select("country");

  // const cityCount =
  //   geoData?.reduce((acc, curr) => acc + (curr.cities?.length || 0), 0) || 0;
  const countryCount = geoData?.length || 0;
  const staticCount = 50;

  const totalUrls =
    (jobCount || 0) +
    // (aliasCount || 0) +
    // cityCount +
    countryCount +
    staticCount;
  const numberOfSitemaps = Math.ceil(totalUrls / LIMIT_PER_SITEMAP);

  return Array.from({ length: numberOfSitemaps || 1 }, (_, i) => ({ id: i }));
}

/**
 * 2. SITEMAP (The Content Provider)
 * Logic: Stream-based indexing [Static] -> [Locations] -> [Jobs]
 */
export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  const supabase = createServiceRoleClient();
  const start = id * LIMIT_PER_SITEMAP;
  const end = start + LIMIT_PER_SITEMAP;

  let finalSitemap: MetadataRoute.Sitemap = [];

  // --- STAGE 1: Static Pages (Indices 0-3) ---
  const staticUrls: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/jobs`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/auth/sign-up`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/auth/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/auth/forgot-password`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy-policy`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms-of-service`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  // --- STAGE 2: Location Slugs (Indices 4 to ~72,000+) ---
  // We fetch all slugs to maintain a stable order, then slice the ones needed for this 'id'
  // const { data: aliases } = await supabase
  //   .from("location_aliases")
  //   .select("alias");
  const { data: geoData } = await supabase
    .from("countries_and_cities")
    .select("country");

  const locationSlugsSet = new Set<string>();
  // aliases?.forEach((a) => locationSlugsSet.add(a.alias.toLowerCase()));
  geoData?.forEach((g) => {
    if (g.country) locationSlugsSet.add(g.country.toLowerCase());
    // g.cities?.forEach((c: string) => locationSlugsSet.add(c.toLowerCase()));
  });

  const allLocationUrls: MetadataRoute.Sitemap = Array.from(
    locationSlugsSet
  ).map((slug) => ({
    url: `${SITE_URL}/remote-jobs/${encodeURIComponent(slug)}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.9,
  }));

  // Combine Meta (Static + Locations)
  const metaUrls = [...staticUrls, ...allLocationUrls];
  const metaCount = metaUrls.length;

  // Add relevant Meta URLs to this sitemap chunk
  if (start < metaCount) {
    finalSitemap = metaUrls.slice(start, end);
  }

  // --- STAGE 3: Job Postings (Indices metaCount onwards) ---
  // If this sitemap chunk still has room after adding metaUrls, fill it with jobs
  if (finalSitemap.length < LIMIT_PER_SITEMAP) {
    const jobsNeeded = LIMIT_PER_SITEMAP - finalSitemap.length;

    // Calculate the offset in the jobs table
    // If start is 0, offset is 0. If start > metaCount, offset is start - metaCount
    const jobOffset = Math.max(0, start - metaCount);

    const { data: jobs } = await supabase
      .from("all_jobs")
      .select("id")
      .order("created_at", { ascending: false })
      .range(jobOffset, jobOffset + jobsNeeded - 1);

    const jobUrls: MetadataRoute.Sitemap = (jobs || []).map((j) => ({
      url: `${SITE_URL}/jobs/${j.id}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    }));

    finalSitemap = [...finalSitemap, ...jobUrls];
  }

  return finalSitemap.slice(0, LIMIT_PER_SITEMAP);
}
