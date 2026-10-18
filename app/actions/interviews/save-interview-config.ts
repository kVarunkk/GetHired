"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/helpers/companies/permissions";
import { companyAllows, requireCompanyForAction } from "@/helpers/companies/require-company";
import { saveInterviewConfig, type SaveInterviewConfigResult } from "@/helpers/interview/screening/config";
import { countUnscreenedApplications } from "@/helpers/matching/queue-screenings";

export type SaveInterviewConfigActionResult =
  | (Extract<SaveInterviewConfigResult, { ok: true }> & {
      /**
       * SIT-03D: applications still to screen when the interview invites by
       * fit score, so the section can offer queueJobScreenings. Null when that
       * doesn't apply or the member can't run screening.
       */
      unscreened: number | null;
    })
  | Extract<SaveInterviewConfigResult, { ok: false }>;

/**
 * SERVER ACTION: saves a job's AI interview config (SI-REQ-001). Needs
 * interviews.manage and jobs.edit on the job; the company is the session's.
 * Invites already sent keep their snapshot (SI-REQ-003).
 */
export async function saveInterviewConfigAction({
  jobPostId,
  config,
}: {
  jobPostId: string;
  config: unknown;
}): Promise<SaveInterviewConfigActionResult> {
  const jobId = typeof jobPostId === "string" ? jobPostId : null;
  const auth = await requireCompanyForAction({ permission: "interviews.manage", jobId });
  if (!auth.ok) return { ok: false, error: auth.error };
  const denied = companyAllows(auth.company, { permission: "jobs.edit", jobId });
  if (denied) return { ok: false, error: denied };

  const { data: job } = await auth.supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job posting not found." };

  const result = await saveInterviewConfig(auth.supabase, { companyId: auth.company.id, jobPostId }, config);
  if (!result.ok) return result;
  revalidatePath(`/company/job-posts/${jobPostId}`);

  const offersScreening =
    result.config.enabled &&
    result.config.invite_rule === "fit_threshold" &&
    can(auth.company, "applicants.screen", jobPostId);
  const unscreened = offersScreening ? await countUnscreenedApplications(auth.supabase, jobPostId) : null;
  return { ...result, unscreened };
}
