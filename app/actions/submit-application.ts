"use server";

import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import {
  submitApplication,
  type SubmitApplicationInput,
  type SubmitApplicationResult,
} from "@/helpers/applications/submit-application";

const NOT_APPLICANT = "Sign in with an applicant account to apply.";

/** SERVER ACTION (AF-REQ-007): applies to a platform job as the session's applicant. */
export async function submitApplicationAction(input: SubmitApplicationInput): Promise<SubmitApplicationResult> {
  const user = await getUserFromRequest();
  if (!user || user.app_metadata?.type === "company") return { ok: false, error: NOT_APPLICANT };
  return submitApplication(await createClient(), user, input);
}
