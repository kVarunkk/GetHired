"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ allJobsId: z.string().uuid() }).strict();

export type RemoveExternalApplicationResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION (BW-F08): deletes the session applicant's own external
 * application. Needs the applicant delete policy from
 * 20261020120000_browser_write_guards.sql; until then it deletes nothing and
 * says so.
 */
export async function removeExternalApplicationAction(
  input: z.input<typeof inputSchema>,
): Promise<RemoveExternalApplicationResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Application not found." };
  const { allJobsId } = parsed.data;

  const supabase = await createClient();
  const job = await loadExternalJob(supabase, allJobsId);
  if (!job.ok) return job;

  const { data: deleted, error } = await supabase
    .from("applications")
    .delete()
    .eq("all_jobs_id", allJobsId)
    .eq("applicant_user_id", user.id)
    .is("job_post_id", null)
    .select("id");
  if (error) return { ok: false, error: "An unexpected error occurred." };
  if (!deleted || deleted.length === 0) return { ok: false, error: "Application not found." };

  return { ok: true };
}
