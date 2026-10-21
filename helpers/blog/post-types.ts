// Client-safe: used by the Keystatic schema, the blog list and post pages.

export const BLOG_POST_TYPES = ["job-seekers", "companies"] as const;

export type BlogPostType = (typeof BLOG_POST_TYPES)[number];

export const BLOG_POST_TYPE_LABELS: Record<BlogPostType, string> = {
  "job-seekers": "For job seekers",
  companies: "For companies",
};

export type BlogPostSummary = {
  slug: string;
  title: string;
  image: string | null;
  /** `YYYY-MM-DD`, as Keystatic stores it. */
  publishedAt: string;
  type: BlogPostType;
};

/** "21 Oct 2026". Parsed as UTC so the day doesn't shift with the timezone. */
export function formatPublishedAt(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
