import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") || "10";
    const supabase = await createClient();

    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: resumes, error } = await supabase
      .from("resumes")
      .select("id, name, created_at, updated_at, is_primary")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(parseInt(limit) || 10);

    if (error) {
      console.log(error);
      return NextResponse.json(
        { error: "Failed to fetch resumes." },
        { status: 500 },
      );
    }
    return NextResponse.json({ data: resumes });
  } catch (e) {
    console.log(e);
    return NextResponse.json(
      { error: "An error occurred while fetching resumes." },
      { status: 500 },
    );
  }
}
