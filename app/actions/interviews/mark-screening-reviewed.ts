"use server";

import { revalidatePath } from "next/cache";
import { companyAllows, requireCompanyForAction } from "@/helpers/companies/require-company";
import { manageMessage } from "@/helpers/interview/screening/copy";

export type MarkScreeningReviewedResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: marks a finished AI interview reviewed for the whole team,
 * which takes it off the dashboard's Needs attention. Needs interviews.manage
 * on the interview's job; the RPC checks it again.
 */
export async function markScreeningReviewedAction({ id }: { id: string }): Promise<MarkScreeningReviewedResult> {
  const auth = await requireCompanyForAction({ permission: "interviews.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (typeof id !== "string") return { ok: false, error: manageMessage("not_found") };

  // RLS: only interviews on jobs the member has interviews.view on.
  const { data: interview } = await auth.supabase
    .from("application_interviews")
    .select("job_post_id, application_id")
    .eq("id", id)
    .maybeSingle();
  if (!interview) return { ok: false, error: manageMessage("not_found") };
  const denied = companyAllows(auth.company, { permission: "interviews.manage", jobId: interview.job_post_id });
  if (denied) return { ok: false, error: denied };

  const { data, error } = await auth.supabase.rpc("mark_screening_interview_reviewed", { p_id: id });
  const result = data as { ok: boolean; reason?: string } | null;
  if (error || !result) return { ok: false, error: manageMessage("unknown") };
  if (!result.ok) return { ok: false, error: manageMessage(result.reason ?? "unknown") };

  revalidatePath(`/company/applications/${interview.application_id}`, "layout");
  revalidatePath("/company");
  return { ok: true };
}
