import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/utils/types/database.types";

/**
 * Applicant profile summary: account info, credits, weekly metrics and the
 * three most recent applications. Shared by GET /api/user/profile and the
 * agent's getMyProfile tool. Database errors are thrown.
 */
export async function getProfile(
  supabase: SupabaseClient<Database>,
  user: { id: string; email?: string },
) {
  const { data: userInfoData, error: userInfoError } = await supabase
    .from("user_info")
    .select(
      "full_name, email, ai_credits, updated_at, filled, invitations_count",
    )
    .eq("user_id", user.id)
    .single();

  if (userInfoError) throw userInfoError;

  const [metricsRes, appliedJobsRes] = await Promise.all([
    supabase.rpc("get_applicant_weekly_metrics", { p_user_id: user.id }),
    supabase
      .from("applications")
      .select(
        "status, created_at, all_jobs!inner(id, job_name, company_name, platform, locations)",
      )
      .eq("applicant_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  if (metricsRes.error) throw metricsRes.error;
  if (appliedJobsRes.error) throw appliedJobsRes.error;

  const metrics = metricsRes.data?.[0] || {};
  const recentApplications =
    appliedJobsRes.data?.map((each) => ({
      ...each.all_jobs,
      status: each.status,
      applied_at: each.created_at,
    })) || [];

  return {
    user_id: user.id,
    email: user.email,
    full_name: userInfoData.full_name,
    ai_credits: userInfoData.ai_credits,
    onboarding_complete: userInfoData.filled,
    invitations_count: userInfoData.invitations_count,
    metrics,
    recent_applications: recentApplications,
  };
}

export type UserProfile = Awaited<ReturnType<typeof getProfile>>;
