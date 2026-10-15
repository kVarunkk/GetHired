import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { RA_PROMPT_JOBS } from "./config";
import type { RecruiterJobSummary, RecruiterPromptContext } from "./system-prompt";

/**
 * The company's jobs with applicant counts, active first (RA spec §4.5). The
 * RPC checks the caller is a member of the company. Errors are thrown.
 */
export async function loadRecruiterJobSummaries(
  supabase: SupabaseClient<Database>,
  companyId: string,
  { status, limit }: { status?: Database["public"]["Enums"]["job_posting_status"]; limit: number },
): Promise<RecruiterJobSummary[]> {
  const { data, error } = await supabase.rpc("get_recruiter_job_summaries", {
    p_company_id: companyId,
    ...(status ? { p_status: status } : {}),
    p_limit: limit,
  });
  if (error) throw new Error(`Failed to load job summaries: ${error.message}`);
  return data ?? [];
}

/**
 * What the recruiter prompt shows about the company, loaded once per turn:
 * the top jobs and the plan. A plan that can't be loaded is left out rather
 * than failing the turn.
 */
export async function loadRecruiterPromptContext(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
): Promise<RecruiterPromptContext> {
  const [jobs, plan] = await Promise.all([
    loadRecruiterJobSummaries(supabase, company.id, { limit: RA_PROMPT_JOBS }),
    getEntitlements(company.id).then(
      ({ tier, creditBalance, entitlements }) => ({
        name: tier.name,
        creditBalance,
        remaining: {
          activeJobPosts: entitlements.active_job_posts?.remaining ?? null,
          profilesPerSearch: entitlements.profiles_per_search?.amount ?? null,
          screenings: entitlements.screenings?.remaining ?? null,
          agentMessages: entitlements.agent_messages?.remaining ?? null,
        },
      }),
      () => null,
    ),
  ]);

  return { company: { name: company.name }, plan, jobs };
}
