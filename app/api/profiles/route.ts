import { loadProfilesFeed } from "@/helpers/profiles/profiles-feed";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  const searchParams = request.nextUrl.searchParams;

  const userId = searchParams.get("userId");

  const user =
    isInternalCall && userId
      ? (await supabase.auth.admin.getUserById(userId)).data.user
      : await getUserFromRequest();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { status, body } = await loadProfilesFeed({ supabase, user, searchParams, isInternalCall });
  return NextResponse.json(body, { status });
}
