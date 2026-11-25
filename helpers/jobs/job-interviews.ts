import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can, forbiddenMessage } from "@/helpers/companies/permissions";
import { reportError } from "@/helpers/posthog/report-error";

/** An AI screening interview the candidate can still take (D9). */
const OPEN_STATUSES = ["invited", "paused"] as const;

/** How many open AI screening interviews a job has, for the close dialog (D9). */
export async function countOpenScreeningInterviews(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("application_interviews")
    .select("id", { count: "exact", head: true })
    .eq("job_post_id", jobPostId)
    .in("status", [...OPEN_STATUSES]);
  if (error) return 0;
  return count ?? 0;
}

export type CancelInterviewsResult =
  | { ok: true; cancelled: number; failed: number }
  | { ok: false; error: string };

/**
 * D9: cancels a closed or filled job's open AI screening interviews through
 * `manage_screening_interview`, which releases each one's held minutes and
 * logs the event. Human interviews and applications aren't touched. Needs
 * `interviews.manage` on the job; the RPC checks it again per interview.
 */
export async function cancelOpenScreeningInterviews(
  { supabase, company }: { supabase: SupabaseClient<Database>; company: MyCompany },
  jobPostId: string,
): Promise<CancelInterviewsResult> {
  if (!can(company, "interviews.manage", jobPostId)) {
    return { ok: false, error: forbiddenMessage("interviews.manage", { forJob: true }) };
  }

  const { data, error } = await supabase
    .from("application_interviews")
    .select("id")
    .eq("job_post_id", jobPostId)
    .in("status", [...OPEN_STATUSES]);
  if (error) return { ok: false, error: "Failed to load the job's AI interviews." };

  let cancelled = 0;
  let failed = 0;
  for (const { id } of data ?? []) {
    const { data: res, error: rpcError } = await supabase.rpc("manage_screening_interview", {
      p_id: id,
      p_action: "cancel",
    });
    const ok = !rpcError && (res as { ok?: boolean } | null)?.ok;
    if (ok) cancelled += 1;
    else {
      failed += 1;
      reportError(`[job state] couldn't cancel AI interview ${id}`, rpcError ?? res);
    }
  }
  return { ok: true, cancelled, failed };
}
