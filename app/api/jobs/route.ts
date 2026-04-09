import { buildQuery } from "@/helpers/jobs/filterQueryBuilder";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankJobsIfApplicable } from "@/helpers/jobs/ai-rerank-jobs";
import { TAICredits } from "@/utils/types";
import { getCutOffDate } from "@/utils/serverUtils";

export async function GET(request: NextRequest) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  const searchParams = request.nextUrl.searchParams;
  const jobType = searchParams.get("jobType");
  const location = searchParams.get("location");
  const visaRequirement = searchParams.get("visaRequirement");
  const minSalary = searchParams.get("minSalary");
  const minExperience = searchParams.get("minExperience");
  const platform = searchParams.get("platform");
  const companyName = searchParams.get("companyName");
  const sortBy = searchParams.get("sortBy") ?? "created_at";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const jobTitleKeywords = searchParams.get("jobTitleKeywords");
  const isFavoriteTabActive = searchParams.get("tab") === "saved";
  const isAppliedJobsTabActive = searchParams.get("tab") === "applied";
  const applicationStatus = searchParams.get("applicationStatus");
  const createdAfter = searchParams.get("createdAfter");
  const createdAfterDate = createdAfter
    ? getCutOffDate(Number(createdAfter))
    : null;
  const applicantUserId = searchParams.get("userId");
  const jobId = searchParams.get("jobId");
  const cursor = searchParams.get("cursor");
  const limit = parseInt(searchParams.get("limit") || "20");

  try {
    let userEmbedding = null;
    let jobEmbedding = null;
    let userId;
    let aiCredits = 0;

    let relevanceSearchType: "standard" | "job_digest" | "similar_jobs" | null =
      null;

    if (sortBy === "relevance") {
      if (applicantUserId) {
        userId = applicantUserId;
        relevanceSearchType = "job_digest";
      } else {
        relevanceSearchType = jobId ? "similar_jobs" : "standard";

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error || !user) {
          relevanceSearchType = null;
          return;
        }

        userId = user.id;

        if (jobId) {
          const { data: jobData, error: jobDataError } = await supabase
            .from("all_jobs")
            .select("embedding_new")
            .eq("id", jobId)
            .single();
          if (jobDataError || !jobData) {
            relevanceSearchType = null;
            return;
          }
          jobEmbedding = jobData.embedding_new;
        }
      }

      const { data: userData, error: userDataError } = await supabase
        .from("user_info")
        .select("embedding_new, ai_credits")
        .eq("user_id", userId)
        .single();

      if (userDataError || !userData) {
        relevanceSearchType = null;
        return;
      }
      aiCredits = userData.ai_credits;
      userEmbedding = userData.embedding_new;
    }

    if (
      relevanceSearchType === "standard" &&
      aiCredits < TAICredits.AI_SEARCH_ASK_AI_RESUME
    ) {
      return NextResponse.json(
        { error: "Insufficient AI credits. Please top up to continue." },
        { status: 402 },
      );
    }

    const { data, error, nextCursor, count, matchedJobIds } = await buildQuery({
      jobType,
      location,
      visaRequirement,
      minSalary,
      minExperience,
      platform,
      companyName,
      cursor,
      limit,
      sortBy,
      sortOrder,
      jobTitleKeywords,
      isFavoriteTabActive: isFavoriteTabActive,
      isAppliedJobsTabActive: isAppliedJobsTabActive,
      userEmbedding,
      applicationStatus,
      createdAfter: createdAfterDate,
      isInternalCall,
      jobEmbedding,
      relevanceSearchType,
      userId: applicantUserId,
    });

    if (error) {
      return NextResponse.json({ error: error }, { status: 500 });
    }

    const { initialJobs, totalCount } = await rerankJobsIfApplicable({
      initialJobs: data,
      initialCount: count,
      userId,
      jobId,
      aiCredits,
      matchedJobIds,
      relevanceSearchType,
      cursor,
    });

    return NextResponse.json({
      data: initialJobs,
      totalCount,
      nextCursor,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
