"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import type { SendOutreachInput } from "@/helpers/outreach/config";
import { sendOutreach, type SendOutreachResult } from "@/helpers/outreach/send";

/**
 * SERVER ACTION (OR-TASK-002): a company member sends an outreach from a
 * candidate card or the profile page. The company comes from the session; the
 * input is validated in `sendOutreach`.
 */
export async function sendOutreachAction(input: SendOutreachInput): Promise<SendOutreachResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error, code: "NOT_MEMBER", status: 403 };

  const result = await sendOutreach(auth, input, { source: "manual" });
  if (result.ok) {
    revalidatePath(`/company/profiles/${result.outreach.candidate_user_id}`);
    revalidatePath("/company/outreach");
  }
  return result;
}
