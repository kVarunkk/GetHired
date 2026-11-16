"use server";

import { revalidatePath } from "next/cache";
import { applicationPath } from "@/helpers/applications/application-page";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { markInterview, type LifecycleResult } from "@/helpers/interviews/interviews";

/**
 * SERVER ACTION (IVT-018, IV-REQ-024): marks an interview completed or a
 * no-show. `mark_interview` checks `scheduling.manage` for its job and the
 * times (no-show only after the start, up to 7 days after the end).
 */
export async function markInterviewAction(input: {
  interviewId: string;
  status: "completed" | "no_show";
}): Promise<LifecycleResult> {
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await markInterview(auth.supabase, input);
  if (result.ok) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}
