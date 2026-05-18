import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ review_id: string }>;
  },
) {
  try {
    const { review_id: reviewId } = await params;
    if (!reviewId) {
      return NextResponse.json(
        { error: "Missing review_id parameter." },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: review, error } = await supabase
      .from("resume_reviews")
      .select(
        "id, name, status, ai_response, score, created_at, updated_at, resume_id, analysis_failed, job_id, target_jd",
      )
      .eq("user_id", user.id)
      .eq("id", reviewId)
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch review details." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: review });
  } catch {
    return NextResponse.json(
      { error: "An error occurred while fetching review details." },
      { status: 500 },
    );
  }
}
