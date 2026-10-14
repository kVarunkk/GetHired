import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AIRerankRequestBody,
  AllJobWithRelations,
  TAICredits,
} from "@/utils/types";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { rerankWithJev } from "@/utils/rerank-jev";

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

    const [jobsResponse, referenceJobResponse] = await Promise.all([
      supabase
        .from("all_jobs")
        .select("id, description")
        .in(
          "id",
          jobs.map((each) => each.id),
        ),
      supabase
        .from("all_jobs")
        .select(
          "id, job_name, description, experience, salary_range, locations",
        )
        .eq("id", jobId)
        .single(),
    ]);

    if (referenceJobResponse.error) throw referenceJobResponse.error;
    if (jobsResponse.error) throw jobsResponse.error;

    // const userPreferences = userResponse.data;

    if (!referenceJobResponse.data) {
      return NextResponse.json(
        { message: "Reference Job not found." },
        { status: 404 },
      );
    }

    const descriptionMap = new Map(
      jobsResponse.data?.map((job) => [job.id, job.description]) || [],
    );

    const enrichedJobs = jobs.map((job) => ({
      ...job,
      description: descriptionMap.get(job.id) || "",
    }));

    const object = await rerankWithJev({
      type: "similar_jobs",
      reference: referenceJobResponse.data as AllJobWithRelations,
      items: enrichedJobs,
    });

    await deductUserCreditsHelper(
      supabase,
      userId,
      TAICredits.AI_SEARCH_ASK_AI_RESUME,
    );

    return NextResponse.json({
      rerankedJobs: object.reranked_job_ids,
      filteredOutJobs: object.filtered_out_ids,
    });
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}
