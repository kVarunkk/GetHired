import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const [locationsResult, companiesResult] = await Promise.all([
      supabase.rpc("get_unique_locations_company_info"),
      supabase.rpc("get_unique_companies_company_info"),
    ]);

    if (locationsResult.error) {
      throw locationsResult.error;
    }
    if (companiesResult.error) {
      throw companiesResult.error;
    }
    const locations = locationsResult.data || [];
    const companies = companiesResult.data || [];

    return NextResponse.json(
      { uniqueLocations: locations, companies },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch filters" },
      { status: 500 },
    );
  }
}
