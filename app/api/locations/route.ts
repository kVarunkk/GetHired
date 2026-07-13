import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const getCachedLocations = (search: string) =>
  unstable_cache(
    async (query: string) => {
      console.log(`=== [CACHE MISS] Fetching "${query}" from Supabase ===`);
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
    const search = searchParams.get("query")?.trim() || "";

    if (!search) {
      return NextResponse.json({ data: [{ location: "Remote" }] });
    }

    const data = await getCachedLocations(search);

    const locationSet = new Set<string>();
    const lowerSearch = search.toLowerCase();

    if (Array.isArray(data)) {
      data.forEach((row) => {
        if (row.country && row.country.toLowerCase().includes(lowerSearch)) {
          locationSet.add(row.country);
        }
        if (row.city && row.city.toLowerCase().includes(lowerSearch)) {
          locationSet.add(row.city);
        }
      });
    }

    const finalLocations = Array.from(locationSet)
      .slice(0, 50)
      .map((loc) => ({ location: loc }));

    return NextResponse.json({ data: finalLocations });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
