"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { applicantRpcResult, requireApplicant, type ApplicantActionResult } from "@/helpers/interview/screening/applicant-rpc";
import { applicantMessage } from "@/helpers/interview/screening/copy";
import { notifyCompanyOfCandidateResponse } from "@/helpers/interview/screening/notify-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const ACCOMMODATION_MAX_CHARS = 500;

/**
 * SERVER ACTION: "Request an alternative format" (SI-REQ-026). Pauses the
 * deadline and emails the company, who extends, waives or cancels.
 */
export async function requestScreeningAccommodationAction({
  id,
  text,
}: {
  id: string;
  text: string;
}): Promise<ApplicantActionResult> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed || trimmed.length > ACCOMMODATION_MAX_CHARS) {
    return { ok: false, error: applicantMessage("invalid_text") };
  }

  const { data, error } = await auth.supabase.rpc("request_screening_accommodation", { p_id: id, p_text: trimmed });
  const result = applicantRpcResult(data, error);
  if (result.ok) {
    after(() => notifyCompanyOfCandidateResponse(createServiceRoleClient(), id, "accommodation"));
    revalidatePath(`/interview/screening/${id}`);
    revalidatePath("/dashboard");
  }
  return result;
}
