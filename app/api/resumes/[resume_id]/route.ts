import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resume_id: string }> },
) {
  try {
    const { resume_id: resumeId } = await params;
    if (!resumeId) {
      return NextResponse.json(
        { error: "Missing resume_id parameter." },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: resume, error } = await supabase
      .from("resumes")
      .select("id, name, content, created_at, updated_at, is_primary")
      .eq("user_id", user.id)
      .eq("id", resumeId)
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch resume details." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: resume });
  } catch {
    return NextResponse.json(
      { error: "An error occurred while fetching resume details." },
      { status: 500 },
    );
  }
}
