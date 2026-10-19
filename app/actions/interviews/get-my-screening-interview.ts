"use server";

import { requireApplicant } from "@/helpers/interview/screening/applicant-rpc";
import { applicantMessage } from "@/helpers/interview/screening/copy";
import { getMyScreeningInterview, type MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";

/**
 * SERVER ACTION: the session applicant's screening interview, read again
 * after an attempt ends while the voice server reports the transcript
 * (SIT-053). Never the questions or competency descriptions.
 */
export async function getMyScreeningInterviewAction({
  id,
}: {
  id: string;
}): Promise<{ ok: true; interview: MyScreeningInterview } | { ok: false; error: string }> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  const interview = await getMyScreeningInterview(auth.supabase, id);
  return interview ? { ok: true, interview } : { ok: false, error: applicantMessage("not_found") };
}
