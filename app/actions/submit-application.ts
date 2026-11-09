"use server";

import { revalidatePath } from "next/cache";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import {
  submitApplication,
  type SubmitApplicationInput,
  type SubmitApplicationResult,
} from "@/helpers/applications/submit-application";

const NOT_APPLICANT = "Sign in with an applicant account to apply.";

/**
 * SERVER ACTION (AF-REQ-007): applies to a platform job as the session's
 * applicant. A new resume comes as `resume` in `files`, in place of
 * `input.resumeId`, and is parsed only once the application can go through.
 */
export async function submitApplicationAction(
  input: SubmitApplicationInput,
  files?: FormData,
): Promise<SubmitApplicationResult> {
  const user = await getUserFromRequest();
  if (!user || user.app_metadata?.type === "company") return { ok: false, error: NOT_APPLICANT };

  const file = files?.get("resume");
  const resumeFile = file instanceof File ? file : undefined;
  const result = await submitApplication(await createClient(), user, input, { resumeFile });
  if (result.ok && resumeFile) revalidatePath("/resume");
  return result;
}
