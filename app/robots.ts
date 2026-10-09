import { getSitemapData, SITEMAP_URL_LIMIT } from "@/helpers/seo/sitemap-data";
import { MetadataRoute } from "next";

export const revalidate = 86400;

const SITE_URL = "https://gethired.devhub.co.in";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { jobCount, staticPaths, locationSlugs } = await getSitemapData();
  const totalUrls = jobCount + staticPaths.length + locationSlugs.length;
  const sitemapCount = Math.max(Math.ceil(totalUrls / SITEMAP_URL_LIMIT), 1);

  return {
    rules: [
      { userAgent: "Googlebot", allow: "/", crawlDelay: 2 },
      { userAgent: "Bingbot", allow: "/", crawlDelay: 2 },
      { userAgent: "Slurp", allow: "/", crawlDelay: 2 },
      { userAgent: "AhrefsBot", disallow: "/" },
      { userAgent: "SemrushBot", disallow: "/" },
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "DotBot", disallow: "/" },
      { userAgent: "BLEXBot", disallow: "/" },
      { userAgent: "DataForSeoBot", disallow: "/" },
      { userAgent: "PetalBot", disallow: "/" },
      { userAgent: "Amazonbot", disallow: "/" },
      { userAgent: "*", allow: "/", disallow: "/api/", crawlDelay: 10 },
    ],
    sitemap: Array.from(
      { length: sitemapCount },
      (_, id) => `${SITE_URL}/sitemap/${id}.xml`,
    ),
  };
}
