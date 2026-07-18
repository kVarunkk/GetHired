import { createPublicClient } from "@/lib/supabase/public";

export async function getPlatformStats() {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_platform_stats");

  if (error || !data || !data.length)
    return {
      jobCount: 8120,
      applicationCount: 520,
      resumeCount: 230,
      userCount: 2110,
    };

  return {
    jobCount: data[0].job_count || 8120,
    applicationCount: data[0].application_count || 520,
    resumeCount: data[0].resume_count || 230,
    userCount: data[0].user_count || 2110,
  };
}
