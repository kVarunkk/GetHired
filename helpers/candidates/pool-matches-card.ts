import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { listPoolMatches, type PoolMatch, type PoolMatches } from "./pool-matches";

export type PoolMatchesCardData = {
  status: Extract<PoolMatches, { ok: true }>["status"];
  matches: PoolMatch[];
  /** Null without applicants.import for the job: no adding. */
  stages: { id: string; name: string }[] | null;
};

/**
 * The job page's "From your candidates" card (CP-REQ-060), or null when it
 * isn't shown: without talent.view and jobs.view for the job, when the
 * company has no embedded candidates, or when matching fails (the card is
 * extra).
 */
export async function loadPoolMatchesCard(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  jobId: string,
): Promise<PoolMatchesCardData | null> {
  if (!can(company, "talent.view") || !can(company, "jobs.view", jobId)) return null;
  const canAdd = can(company, "applicants.import", jobId);
  const [result, stages] = await Promise.all([
    listPoolMatches(supabase, jobId),
    canAdd
      ? supabase
          .from("pipeline_stages")
          .select("id, name")
          .eq("company_id", company.id)
          .eq("archived", false)
          .order("position", { ascending: true })
      : null,
  ]);
  if (!result.ok || result.status === "no_pool") return null;
  return {
    status: result.status,
    matches: result.matches,
    stages: canAdd ? (stages?.data ?? []) : null,
  };
}

/**
 * How many people the post-create notice names (CP-REQ-061): only on a job's
 * first open after it was made, and only once it has matches. Null hides it.
 */
export function poolNoticeCount(card: PoolMatchesCardData | null, created: boolean): number | null {
  if (!created || card?.status !== "ok" || card.matches.length === 0) return null;
  return card.matches.length;
}
