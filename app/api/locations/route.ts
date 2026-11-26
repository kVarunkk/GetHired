import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DEFAULT_CITIES } from "@/utils/utils";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const MAX_QUERY_LENGTH = 60;

/**
 * What can be searched for: the text goes into a PostgREST `or` filter on a
 * service role client, so its syntax characters and wildcards are removed. The
 * limit also bounds the cache keys.
 */
const toSearchTerm = (query: string) =>
  query
    .replace(/[,()"\\*%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .toLowerCase();

// The list rarely changes and is the same for everyone, so the browser keeps it
// for a few minutes. `private`: a response can carry a refreshed session cookie.
const CACHE_HEADERS = { "Cache-Control": "private, max-age=300" };

const getCachedLocations = (search: string) =>
  unstable_cache(
    async (query: string) => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("flat_locations")
        .select("country, city")
        .or(`country.ilike.%${query}%,city.ilike.%${query}%`);

      if (error) throw error;
      return data || [];
    },
    [`location-search-${search}`],
    { revalidate: 3600, tags: ["locations"] },
  )(search);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query")?.trim() || "";

    if (!query) {
      return NextResponse.json({ data: DEFAULT_CITIES }, { headers: CACHE_HEADERS });
    }

    const search = toSearchTerm(query);
    if (!search) {
      return NextResponse.json({ data: [] }, { headers: CACHE_HEADERS });
    }

    const data = await getCachedLocations(search);

    const locationSet = new Set<string>();
    if (Array.isArray(data)) {
      data.forEach((row) => {
        if (row.country && row.country.toLowerCase().includes(search)) {
          locationSet.add(row.country);
        }
        if (row.city && row.city.toLowerCase().includes(search)) {
          locationSet.add(row.city);
        }
      });
    }

    const finalLocations = Array.from(locationSet)
      .slice(0, 50)
      .map((loc) => ({ location: loc }));

    return NextResponse.json({ data: finalLocations }, { headers: CACHE_HEADERS });
  } catch (err: unknown) {
    reportError("[locations] failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
