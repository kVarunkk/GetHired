"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { applicantRpcResult, requireApplicant, type ApplicantActionResult } from "@/helpers/interview/screening/applicant-rpc";
import { notifyCompanyOfCandidateResponse } from "@/helpers/interview/screening/notify-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION: the applicant declines the interview but keeps the
 * application (SI-REQ-016). The company is emailed after the response.
 */
export async function declineScreeningInterviewAction({ id }: { id: string }): Promise<ApplicantActionResult> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("decline_screening_interview", { p_id: id });
  const result = applicantRpcResult(data, error);
  if (result.ok) {
    after(() => notifyCompanyOfCandidateResponse(createServiceRoleClient(), id, "declined"));
    revalidatePath(`/interview/screening/${id}`);
    revalidatePath("/dashboard");
  }
  return result;
}
