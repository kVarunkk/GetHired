"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { inviteApplicants, type InviteSkipReason } from "@/helpers/interview/screening/invite";
import { inviteSkipMessage } from "@/helpers/interview/screening/copy";

const inputSchema = z
  .object({
    jobPostId: z.string().uuid(),
    applicationIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type InviteToInterviewResult =
  | { ok: true; invited: number; skipped: { id: string; reason: InviteSkipReason; message: string }[] }
  | { ok: false; error: string }
  | EntitlementActionError;

/**
 * SERVER ACTION: invites applicants of one job to its AI interview by hand
 * (SI-REQ-010), from the applicant page or the applicants list (≤ 50). Needs
 * interviews.manage on the job. When none could be paid for, it returns the
 * upgrade dialog's error, like the outreach action.
 */
export async function inviteToInterviewAction(input: {
  jobPostId: string;
  applicationIds: string[];
}): Promise<InviteToInterviewResult> {
  const auth = await requireCompanyForAction({
    permission: "interviews.manage",
    jobId: typeof input?.jobPostId === "string" ? input.jobPostId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose who to invite." };
  const { jobPostId, applicationIds } = parsed.data;

  const result = await inviteApplicants(auth, { jobPostId, applicationIds, via: "manual" });
  if (!result.ok) return result;

  const unpaid = result.skipped.some((s) => s.reason === "insufficient_credits" || s.reason === "member_limit");
  if (result.invited.length === 0 && unpaid) {
    const { data: config } = await auth.supabase
      .from("job_interview_configs")
      .select("duration_minutes")
      .eq("job_post_id", jobPostId)
      .maybeSingle();
    try {
      await assertAllowance(auth.company.id, "interview_minutes", config?.duration_minutes ?? 15, auth.user.id);
    } catch (err) {
      if (err instanceof EntitlementError) return toEntitlementActionError(err);
      throw err;
    }
  }

  if (result.invited.length > 0) {
    revalidatePath(`/company/job-posts/${jobPostId}/applications`);
    for (const { applicationId } of result.invited) revalidatePath(`/company/applications/${applicationId}`, "layout");
  }
  return {
    ok: true,
    invited: result.invited.length,
    skipped: result.skipped.map((s) => ({ ...s, message: inviteSkipMessage(s.reason) })),
  };
}
