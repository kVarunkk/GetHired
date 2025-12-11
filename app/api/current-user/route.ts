import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Set cache properties: Data is user-specific and changes infrequently,
// so we mark it as dynamic to ensure the latest session data is used.
export const dynamic = "force-dynamic";

export async function GET() {
  // 1. Authenticate Request
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

  // 2. Determine User Role from fast JWT metadata
  const userRole = user.app_metadata?.type as
    | "applicant"
    | "company"
    | undefined;
  const userId = user.id;

  let profileData = null;
  let tableName: string | null = null;

  // 3. Select the correct table based on role
  if (userRole === "applicant") {
    tableName = "user_info";
  } else if (userRole === "company") {
    tableName = "company_info";
  } else {
    // User is authenticated but role is undefined (e.g., fresh sign-up)
    return NextResponse.json(
      { profile: null, role: null, message: "Profile role not set." },
      { status: 200 }
    );
  }

  try {
    // 4. Fetch the full profile from the designated table
    const { data, error } = await supabase
      .from(tableName)
      .select("user_id, ai_credits") // Fetch all fields
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      //   console.warn(
      //     `Error fetching profile from ${tableName} for user ${userId}:`,
      //     error
      //   );
      // Return empty profile gracefully if data is missing (e.g., incomplete onboarding)
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
    // console.error("Critical error fetching profile:", e);
    return NextResponse.json(
      { error: "Server error fetching profile data." },
      { status: 500 }
    );
  }

  // 5. Return the consolidated profile data
  return NextResponse.json({
    profile: profileData,
    role: userRole,
    message: "Success.",
  });
}
