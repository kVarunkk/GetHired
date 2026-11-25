"use server";

import { revalidatePath } from "next/cache";
import { applicantRpcResult, requireApplicant, type ApplicantActionResult } from "@/helpers/interview/screening/applicant-rpc";

/**
 * SERVER ACTION: takes an interview that's waiting on the company, or already
 * submitted, off the applicant's dashboard. It comes back if the company acts on it.
 */
export async function dismissScreeningInterviewAction({ id }: { id: string }): Promise<ApplicantActionResult> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("dismiss_my_screening_interview", { p_id: id });
  const result = applicantRpcResult(data, error);
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
