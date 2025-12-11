import { buildQuery } from "@/lib/filterQueryBuilder";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankJobsIfApplicable } from "@/lib/ai-rerank-jobs";
import { IJob } from "@/lib/types";

let JOBS_PER_PAGE = 20;

export async function GET(request: NextRequest) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

  // Choose the client based on the header
  const supabase = isInternalCall
    ? createServiceRoleClient() // No session needed, bypasses RLS
    : await createClient();

  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");

  // Extract filter params
  const jobType = searchParams.get("jobType");
  const location = searchParams.get("location");
  const visaRequirement = searchParams.get("visaRequirement");
  const minSalary = searchParams.get("minSalary");
  const minExperience = searchParams.get("minExperience");
  const platform = searchParams.get("platform");
  const companyName = searchParams.get("companyName");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const jobTitleKeywords = searchParams.get("jobTitleKeywords");
  const isFavoriteTabActive = searchParams.get("tab") === "saved";
  const isAppliedJobsTabActive = searchParams.get("tab") === "applied";
  const applicationStatus = searchParams.get("applicationStatus");
  JOBS_PER_PAGE = parseInt(
    searchParams.get("limit") || JOBS_PER_PAGE.toString()
  );
  const createdAfter = searchParams.get("createdAfter");
  const applicantUserId = searchParams.get("userId");

  const startIndex = (page - 1) * JOBS_PER_PAGE;
  const endIndex = startIndex + JOBS_PER_PAGE - 1;

  try {
    let userEmbedding = null;
    let userId;
    let aiCredits;
    let isJobDigest = false;

    if (applicantUserId) {
      userId = applicantUserId;
      isJobDigest = true;
    } else {
      if (sortBy === "relevance") {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          userId = user.id;
        }
      }
    }

    if (userId) {
      const { data: userData, error } = await supabase
        .from("user_info")
        .select("embedding, ai_credits")
        .eq("user_id", userId)
        .single();
      if (!error && userData) {
        userEmbedding = userData.embedding;
        aiCredits = userData.ai_credits;
      }
    }

    const { data, error, count, matchedJobIds } = await buildQuery({
      jobType,
      location,
      visaRequirement,
      minSalary,
      minExperience,
      platform,
      companyName,
      start_index: startIndex,
      end_index: endIndex,
      sortBy: sortBy ?? undefined,
      sortOrder: sortOrder as "asc" | "desc",
      jobTitleKeywords,
      isFavoriteTabActive: isFavoriteTabActive,
      isAppliedJobsTabActive: isAppliedJobsTabActive,
      userEmbedding,
      applicationStatus,
      createdAfter,
      isInternalCall,
    });

    if (error) {
      return NextResponse.json({ error: error }, { status: 500 });
    }

    const { initialJobs, totalCount } = await rerankJobsIfApplicable({
      initialJobs: data as unknown as IJob[],
      initialCount: count,
      userId,
      aiCredits,
      matchedJobIds,
      isJobDigest,
    });

    return NextResponse.json({ data: initialJobs, totalCount });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
