import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const revalidate = 84600;

/**
 * MANUAL SITEMAP INDEX GENERATOR
 * This route handler returns raw XML to ensure total control over the output.
 * Path: /sitemap.xml
 */
export async function GET() {
  const supabase = createServiceRoleClient();
  const SITE_URL = "https://gethired.devhub.co.in";
  const LIMIT_PER_SITEMAP = 45000;

  try {
    // 1. Calculate total URLs to determine number of child sitemaps
    const { count: jobCount } = await supabase
      .from("all_jobs")
      .select("id", { count: "exact", head: true });

    const { count: aliasCount } = await supabase
      .from("location_aliases")
      .select("id", { count: "exact", head: true });

    const { data: geoData } = await supabase
      .from("countries_and_cities")
      .select("country, cities");

    const cityCount =
      geoData?.reduce((acc, curr) => acc + (curr.cities?.length || 0), 0) || 0;
    const countryCount = geoData?.length || 0;
    const staticCount = 7;

    const totalUrls =
      (jobCount || 0) +
      (aliasCount || 0) +
      cityCount +
      countryCount +
      staticCount;
    const numberOfSitemaps = Math.ceil(totalUrls / LIMIT_PER_SITEMAP);

    const lastMod = new Date().toISOString().split("T")[0];

    // 2. Build the Raw XML String
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (let i = 0; i < Math.max(numberOfSitemaps, 1); i++) {
      xml += `  <sitemap>\n`;
      xml += `    <loc>${SITE_URL}/sitemap/${i}.xml</loc>\n`;
      xml += `    <lastmod>${lastMod}</lastmod>\n`;
      xml += `  </sitemap>\n`;
    }

    xml += `</sitemapindex>`;

    // 3. Return with correct headers
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "text/xml",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=59",
      },
    });
  } catch (err) {
    console.error("[SITEMAP_INDEX_CRITICAL_ERROR]:", err);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE_URL}/sitemap/0.xml</loc></sitemap></sitemapindex>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  }
}
