import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AIRerankRequestBody } from "@/utils/types";
import { rerankSimilarJobs } from "@/helpers/jobs/rerank-jobs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { userId, jobId, jobs, aiCredits }: AIRerankRequestBody =
      await request.json();

    if (!jobId || !userId || !jobs || !aiCredits) {
      return NextResponse.json(
        {
          message: "jobId, userId and jobs are required in the request body.",
        },
        { status: 400 },
      );
    }

    const result = await rerankSimilarJobs(supabase, { userId, jobId, jobs });

    if (!result) {
      return NextResponse.json(
        { message: "Reference Job not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}
