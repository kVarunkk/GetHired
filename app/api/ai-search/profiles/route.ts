import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiSearchProfileBody } from "@/utils/types/api.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankWithJev } from "@/utils/rerank-jev";
import { JobPostingsRow } from "@/utils/types";

export async function POST(request: NextRequest) {
  try {
    const internalSecret = request.headers.get("X-Internal-Secret");
    const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const { userId, jobId, profiles, companyId }: AiSearchProfileBody =
      await request.json();

    if (!userId || !profiles || !jobId || !companyId) {
      return NextResponse.json(
        {
          message: "Required fields are missing in the request body.",
        },
        { status: 400 },
      );
    }

    // Step 1: Fetch the job posting details to use as the AI's "query"
    const { data: jobPosting, error: jobError } = await supabase
      .from("job_postings")
      .select(
        `
        id,
        title,
        description,
        location,
        job_type,
        salary_range,
        experience
      `,
      )
      .eq("id", jobId)
      .single();

    if (jobError || !jobPosting) {
      // console.error("Error fetching job posting:", jobError);
      return NextResponse.json(
        { message: "Job posting not found." },
        { status: 404 },
      );
    }

    const candidates = profiles.map((each) => ({
      id: each.user_id,
      preferences: {
        desired_roles: each.desired_roles ?? undefined,
        top_skills: each.top_skills ?? undefined,
        experience_years: each.experience_years ?? undefined,
        preferred_locations: each.preferred_locations ?? undefined,
        min_salary: each.min_salary ?? undefined,
        max_salary: each.max_salary ?? undefined,
        work_style_preferences: each.work_style_preferences ?? undefined,
        job_type: each.job_type ?? undefined,
        company_size_preference: each.company_size_preference ?? undefined,
        career_goals_short_term: each.career_goals_short_term ?? undefined,
        career_goals_long_term: each.career_goals_long_term ?? undefined,
        visa_sponsorship_required: each.visa_sponsorship_required ?? undefined,
      },
      experienceText: each.resume_experience,
      skillsText: each.resume_skills,
      projectsText: each.resume_projects,
    }));

    const object = await rerankWithJev({
      type: "relevant_profiles",
      reference: jobPosting as JobPostingsRow,
      items: candidates,
    });

    return NextResponse.json({
      rerankedProfiles: object.reranked_job_ids,
      filteredOutProfiles: object.filtered_out_ids,
      scores: object.scores ?? {},
    });
  } catch {
    return NextResponse.json(
      {
        message: "An error occurred",
      },
      { status: 500 },
    );
  }
}
