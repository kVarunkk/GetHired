import { reportError } from "@/helpers/posthog/report-error";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const companiesResult = await supabase.rpc("get_unique_companies");

    if (companiesResult.error) {
      throw companiesResult.error;
    }

    const companies = companiesResult.data || [];

    return NextResponse.json({ companies }, { status: 200 });
  } catch (error) {
    reportError("[jobs/filters] failed", error);
    return NextResponse.json(
      { error: "Failed to fetch filters" },
      { status: 500 }
    );
  }
}
