import { NextRequest, NextResponse } from "next/server";
import { handleUserUpsert } from "@/utils/auth-handlers"; // reuse as-is, no changes needed there
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ message: "Missing token" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ message: "Invalid session" }, { status: 401 });
    }

    const { metadataUpdated, error: upsertError } =
      await handleUserUpsert(user);

    if (upsertError) {
      return NextResponse.json({ message: upsertError }, { status: 500 });
    }

    return NextResponse.json({ ok: true, newUser: metadataUpdated });
  } catch (err) {
    console.error("[ensure-user] failed", err);
    return NextResponse.json({ message: "An error occurred" }, { status: 500 });
  }
}
