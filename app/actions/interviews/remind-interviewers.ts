"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { applicationPath } from "@/helpers/applications/application-page";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { interviewMessage } from "@/helpers/interviews/copy";
import { remindInterviewers, type RemindResult } from "@/helpers/interviews/remind-interviewers";
import { actorName } from "@/helpers/pipeline/move";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-084): "Remind" on an interview. Emails each panel
 * member who hasn't submitted a scorecard, at most once per member per
 * interview per 24 hours. `interviewer_reminders` checks scheduling.manage
 * for the interview's job.
 */
export async function remindInterviewersAction({ interviewId }: { interviewId: string }): Promise<RemindResult> {
  if (!isUuid(interviewId)) return { ok: false, reason: "not_found", error: interviewMessage("not_found") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, reason: "forbidden", error: auth.error };

  const result = await remindInterviewers(
    {
      supabase: auth.supabase,
      admin: createServiceRoleClient(),
      senderName: actorName(auth.user, auth.company) ?? "A teammate",
    },
    interviewId,
  );
  if (result.ok && result.applicationId) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}
