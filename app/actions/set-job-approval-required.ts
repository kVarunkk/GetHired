"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { JOB_SETTINGS_PATH } from "@/helpers/jobs/job-states";

/**
 * SERVER ACTION (JL-REQ-018, D7): turns "approve job posts before they open"
 * on or off for the session company. Owners only, because it governs what
 * other members can do; `protect_company_info_columns` also keeps non-owners
 * off the column. Turning it off leaves pending jobs pending.
 */
export async function setJobApprovalRequiredAction(input: {
  required: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ owner: true });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (typeof input?.required !== "boolean") return { ok: false, error: "Invalid setting." };

  const { error } = await auth.supabase
    .from("company_info")
    .update({ job_approval_required: input.required })
    .eq("id", auth.company.id);
  if (error) return { ok: false, error: "Couldn't save the setting. Please try again." };

  revalidatePath(JOB_SETTINGS_PATH);
  revalidatePath("/company/job-posts", "layout");
  return { ok: true };
}
