"use server";

import { revalidatePath } from "next/cache";
import { applicationPath } from "@/helpers/applications/application-page";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { recordInterview, type LifecycleResult } from "@/helpers/interviews/interviews";
import type { RecordInterviewInput } from "@/helpers/interviews/interview-schema";

/**
 * SERVER ACTION (IVT-018, IV-REQ-020 "Record manually"): records an interview
 * arranged outside GetHired. Nobody is emailed. Needs `scheduling.manage`;
 * `record_interview` checks it for the application's job.
 */
export async function recordInterviewAction(input: RecordInterviewInput): Promise<LifecycleResult> {
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await recordInterview(auth.supabase, input);
  if (result.ok) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}
