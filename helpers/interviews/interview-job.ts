import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * The job of one of the company's scheduled interviews, for a permission
 * check's scope (the recruiter tools' `interviewId` source). Reads through
 * RLS (`scheduling.view` on the job, which `scheduling.manage` includes), so
 * it's null for another company's interview or one the member can't see.
 */
export async function interviewJobId(
  supabase: SupabaseClient<Database>,
  companyId: string,
  interviewId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("scheduled_interviews")
    .select("job_post_id")
    .eq("id", interviewId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the interview: ${error.message}`);
  return data?.job_post_id ?? null;
}
