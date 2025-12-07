import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const manipulateLocations = (data: { country: string; cities: string[] }[]) => {
  const locationSet = new Set<string>();

  locationSet.add("Remote");

  if (Array.isArray(data)) {
    data.forEach((countryData) => {
      locationSet.add(countryData.country);

      countryData.cities.forEach((city: string) => {
        locationSet.add(city);
      });
    });
  }

  const locations = Array.from(locationSet).map((loc) => ({
    location: loc,
  }));
  return locations;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filterComponent = searchParams.get("filterComponent");

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("countries_and_cities")
      .select("country, cities, iso");

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("Data not available");
    }

    const finalLocations = filterComponent ? manipulateLocations(data) : data;

    return NextResponse.json({ data: finalLocations || [] });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
