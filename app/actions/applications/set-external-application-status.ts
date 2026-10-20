"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { Constants } from "@/utils/types/database.types";

const inputSchema = z
  .object({ allJobsId: z.string().uuid(), status: z.enum(Constants.public.Enums.application_status) })
  .strict();

export type SetExternalApplicationStatusResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (BW-F02): the status of the session applicant's own external application. */
export async function setExternalApplicationStatusAction(
  input: z.input<typeof inputSchema>,
): Promise<SetExternalApplicationStatusResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid status." };
  const { allJobsId, status } = parsed.data;

  const supabase = await createClient();
  const job = await loadExternalJob(supabase, allJobsId);
  if (!job.ok) return job;

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("all_jobs_id", allJobsId)
    .eq("applicant_user_id", user.id)
    .is("job_post_id", null)
    .select("id");
  if (error) return { ok: false, error: "An unexpected error occurred." };
  if (!updated || updated.length === 0) return { ok: false, error: "Application not found." };

  return { ok: true };
}
