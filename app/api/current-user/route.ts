import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const userRole = user.app_metadata?.type as
    | "applicant"
    | "company"
    | undefined;
  const userId = user.id;

  let profileData = null;
  let tableName: string | null = null;
  let selectString;

  if (userRole === "applicant") {
    tableName = "user_info";
    selectString =
      "user_id, ai_credits, is_relevant_jobs_generated, is_relevant_job_update_failed";
  } else if (userRole === "company") {
    tableName = "company_info";
    selectString = "user_id, ai_credits";
  } else {
    return NextResponse.json(
      { profile: null, role: null, message: "Profile role not set." },
      { status: 200 }
    );
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(selectString)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          profile: null,
          role: userRole,
          message: "Profile data missing in DB.",
        },
        { status: 200 }
      );
    }

    profileData = data;
  } catch {
    return NextResponse.json(
      { error: "Server error fetching profile data." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    profile: profileData,
    role: userRole,
    message: "Success.",
  });
}
