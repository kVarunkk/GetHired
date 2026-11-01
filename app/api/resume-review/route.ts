import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { startReviewAnalysis } from "@/helpers/resume-review/start-review-analysis";
import { listResumeReviews } from "@/helpers/resume-review/list-resume-reviews";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const { reviewId }: { reviewId: string } = await req.json();

    const userId = user.id;

    if (!reviewId || !userId) {
      return NextResponse.json(
        { error: "Missing parameters" },
        { status: 400 },
      );
    }

    const result = await startReviewAnalysis(supabase, userId, reviewId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    reportError("[resume-review] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Some error occured" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.get("limit");
    const supabase = await createClient();
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reviews = await listResumeReviews(supabase, user, {
      limit: limit ? parseInt(limit) : undefined,
    });

    return NextResponse.json({ data: reviews });
  } catch (error) {
    reportError("[resume-review] couldn't list the reviews", error);
    return NextResponse.json(
      { error: "Error fetching your resume reviews." },
      { status: 500 },
    );
  }
}
