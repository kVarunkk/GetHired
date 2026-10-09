import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "@/app/keystatic.config";
import { createPublicClient } from "@/lib/supabase/public";

const PAGE_SIZE = 1000;

const STATIC_PATHS = [
  "/",
  "/jobs",
  "/hire",
  "/ai-interview",
  "/ai-resume-checker",
  "/mcp-server",
  "/companies",
  "/blog",
  "/privacy-policy",
  "/terms-of-service",
];

const reader = createReader(process.cwd(), keystaticConfig);

export async function getSitemapData() {
  const supabase = createPublicClient();
  const [{ count: jobCount, error: jobCountError }, posts] =
    await Promise.all([
      supabase
        .from("all_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .not("job_name", "is", null)
        .neq("job_name", ""),
      reader.collections.posts.all(),
    ]);

  if (jobCountError) {
    throw new Error(
      `Failed to count active jobs for sitemap: ${jobCountError.message}`,
    );
  }

  const locationSlugs = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("countries_and_cities")
      .select("country")
      .order("country", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch sitemap locations: ${error.message}`);
    }

    data.forEach(({ country }) => {
      const slug = country?.trim().toLowerCase();
      if (slug) locationSlugs.add(slug);
    });

    if (data.length < PAGE_SIZE) break;
  }

  return {
    jobCount: jobCount ?? 0,
    staticPaths: [
      ...STATIC_PATHS,
      ...posts.map((post) => `/blog/${post.slug}`),
    ],
    locationSlugs: [...locationSlugs],
  };
}

export const SITEMAP_URL_LIMIT = 45_000;
export const SITEMAP_PAGE_SIZE = PAGE_SIZE;
