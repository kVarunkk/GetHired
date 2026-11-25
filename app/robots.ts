import { getSitemapData, SITEMAP_URL_LIMIT } from "@/helpers/seo/sitemap-data";
import { MetadataRoute } from "next";

export const revalidate = 86400;

const SITE_URL = "https://gethired.devhub.co.in";

// Crawlers that fetch pages so an AI assistant can answer from them or cite
// them: search indexes (OAI-SearchBot, PerplexityBot, Claude-SearchBot),
// training crawls (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
// CCBot) and fetches made when a person asks about a link (ChatGPT-User,
// Claude-User, Perplexity-User). Each group lists its own rules, since a bot
// with its own group ignores the `*` group, and none of them has a crawl delay.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "Amazonbot",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "MistralAI-User",
  "DuckAssistBot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { jobCount, staticPaths, locationSlugs } = await getSitemapData();
  const totalUrls = jobCount + staticPaths.length + locationSlugs.length;
  const sitemapCount = Math.max(Math.ceil(totalUrls / SITEMAP_URL_LIMIT), 1);

  return {
    rules: [
      { userAgent: "Googlebot", allow: "/", crawlDelay: 2 },
      { userAgent: "Bingbot", allow: "/", crawlDelay: 2 },
      { userAgent: "Slurp", allow: "/", crawlDelay: 2 },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: "/api/" },
      { userAgent: "AhrefsBot", disallow: "/" },
      { userAgent: "SemrushBot", disallow: "/" },
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "DotBot", disallow: "/" },
      { userAgent: "BLEXBot", disallow: "/" },
      { userAgent: "DataForSeoBot", disallow: "/" },
      { userAgent: "PetalBot", disallow: "/" },
      { userAgent: "*", allow: "/", disallow: "/api/", crawlDelay: 10 },
    ],
    sitemap: Array.from(
      { length: sitemapCount },
      (_, id) => `${SITE_URL}/sitemap/${id}.xml`,
    ),
  };
}
