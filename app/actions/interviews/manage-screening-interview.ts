"use server";

import { revalidatePath } from "next/cache";
import { companyAllows, requireCompanyForAction } from "@/helpers/companies/require-company";
import { manageMessage } from "@/helpers/interview/screening/copy";

const ACTIONS = ["cancel", "extend", "grant_attempt", "waive"] as const;
export type ManageScreeningAction = (typeof ACTIONS)[number];

export type ManageScreeningInterviewResult = { ok: true; status: string } | { ok: false; error: string };

/**
 * SERVER ACTION: cancel, extend (1–14 days, twice at most), grant another
 * attempt (once) or waive a paused interview (SI-REQ-015/026). Needs
 * interviews.manage on the interview's job; the RPC checks it again and logs
 * the event.
 */
export async function manageScreeningInterviewAction({
  id,
  action,
  days,
}: {
  id: string;
  action: ManageScreeningAction;
  days?: number;
}): Promise<ManageScreeningInterviewResult> {
  const auth = await requireCompanyForAction({ permission: "interviews.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  if (typeof id !== "string" || !ACTIONS.includes(action)) {
    return { ok: false, error: "Choose what to do with the interview." };
  }
  if (action === "extend" && !(Number.isInteger(days) && days! >= 1 && days! <= 14)) {
    return { ok: false, error: manageMessage("invalid_days") };
  }

  // RLS: only interviews on jobs the member has interviews.view on.
  const { data: interview } = await auth.supabase
    .from("application_interviews")
    .select("job_post_id, application_id")
    .eq("id", id)
    .maybeSingle();
  if (!interview) return { ok: false, error: manageMessage("not_found") };
  const denied = companyAllows(auth.company, { permission: "interviews.manage", jobId: interview.job_post_id });
  if (denied) return { ok: false, error: denied };

  const { data, error } = await auth.supabase.rpc("manage_screening_interview", {
    p_id: id,
    p_action: action,
    ...(action === "extend" ? { p_days: days } : {}),
  });
  const result = data as { ok: boolean; reason?: string; status?: string } | null;
  if (error || !result) return { ok: false, error: manageMessage("unknown") };
  if (!result.ok) return { ok: false, error: manageMessage(result.reason ?? "unknown") };

  revalidatePath(`/company/applicants/${interview.application_id}`);
  return { ok: true, status: result.status ?? "" };
}
