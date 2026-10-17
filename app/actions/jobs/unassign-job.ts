"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { unassignJob } from "@/helpers/companies/role-rpc";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ jobPostId: z.string().uuid(), userId: z.string().uuid() }).strict();

/**
 * SERVER ACTION (RP-REQ-011): removes a team member from a job's hiring team.
 * Needs jobs.assign on that job (rule 6); the RPC also checks the member is
 * assignable and not above the caller (rule 4).
 */
export async function unassignJobAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  const auth = await requireCompanyForAction({
    permission: "jobs.assign",
    jobId: parsed.success ? parsed.data.jobPostId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) return { ok: false, error: "Choose a team member." };

  const result = await unassignJob(auth.supabase, parsed.data.jobPostId, parsed.data.userId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/company/job-posts/${parsed.data.jobPostId}`);
  revalidatePath("/company/settings/hiring-teams");
  await eventCaptureServer({ event: PostHogEvent.JobUnassigned, distinctId: auth.user.id });
  return { ok: true };
}
