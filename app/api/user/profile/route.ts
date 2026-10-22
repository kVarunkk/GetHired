import { reportError } from "@/helpers/posthog/report-error";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/helpers/user/get-profile";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ data: await getProfile(supabase, user) });
  } catch (err) {
    reportError("[user/profile] failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
