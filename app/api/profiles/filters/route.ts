import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: filterData, error: filterError } = await supabase.rpc(
      "get_unique_profile_filters"
    );

    if (filterError) {
      throw filterError;
    }

    const uniqueJobRoles = filterData?.uniqueJobRoles || [];
    const uniqueIndustryPreferences =
      filterData?.uniqueIndustryPreferences || [];
    const uniqueWorkStylePreferences =
      filterData?.uniqueWorkStylePreferences || [];
    const uniqueSkills = filterData?.uniqueSkills || [];
    const locations = filterData?.uniqueLocations || [];
    return NextResponse.json(
      {
        uniqueJobRoles,
        uniqueIndustryPreferences,
        uniqueWorkStylePreferences,
        uniqueSkills,
        locations,
      },
      { status: 200 }
    );
  } catch {
    // console.error("Error fetching filters:", e);
    return NextResponse.json(
      { error: "Failed to fetch filters" },
      { status: 500 }
    );
  }
}
