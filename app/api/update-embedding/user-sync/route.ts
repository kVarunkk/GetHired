import { after, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deploymentUrl } from "@/lib/serverUtils";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const URL = deploymentUrl();

export async function GET() {
  const supabase = createServiceRoleClient();

  // 1. Fetch jobs that don't have embeddings yet (or all if you're migrating)
  const { data: jobs, error } = await supabase
    .from("user_info")
    .select(
      "user_id, desired_roles, preferred_locations, min_salary, max_salary, experience_years, top_skills, skills_resume, experience_resume, projects_resume, work_style_preferences, visa_sponsorship_required, career_goals_long_term, career_goals_short_term, job_type, industry_preferences"
    )
    .eq("filled", true)
    .is("embedding_new", null)
    .limit(100); // Process in manageable chunks per run

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ message: "All jobs are already synced." });
  }

  // 2. Background Processing
  after(
    (async () => {
      console.log(
        `[SYNC] Starting embedding generation for ${jobs.length} users.`
      );

      const BATCH_SIZE = 5; // Low concurrency to stay within Vertex AI RPM limits
      for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batch = jobs.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(async (job) => {
            try {
              const res = await fetch(
                `${URL}/api/update-embedding/gemini/user`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Internal-Secret": INTERNAL_API_SECRET || "",
                  },
                  body: JSON.stringify(job),
                }
              );

              if (!res.ok)
                console.error(`Failed job ${job.user_id}: ${res.status}`);
            } catch {
              console.error(
                `Error calling job embedding API for ${job.user_id}`
              );
            }
          })
        );

        // Small cooldown to prevent hitting rate limits
        await new Promise((r) => setTimeout(r, 500));
      }

      console.log(`[SYNC] Completed batch processing.`);
    })()
  );

  return NextResponse.json({
    success: true,
    message: `Triggered background sync for ${jobs.length} jobs.`,
  });
}
