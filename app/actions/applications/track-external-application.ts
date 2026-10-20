"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ allJobsId: z.string().uuid() }).strict();

export type TrackExternalApplicationResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (BW-F02): records that the session applicant applied to an external job. */
export async function trackExternalApplicationAction(
  input: z.input<typeof inputSchema>,
): Promise<TrackExternalApplicationResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };
  if (user.app_metadata?.type === "company") return { ok: false, error: "Only applicants can track applications." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Job not found." };
  const { allJobsId } = parsed.data;

  const supabase = await createClient();
  const job = await loadExternalJob(supabase, allJobsId);
  if (!job.ok) return job;

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("all_jobs_id", allJobsId)
    .eq("applicant_user_id", user.id)
    .limit(1);
  if ((existing ?? []).length > 0) return { ok: true };

  const { error } = await supabase
    .from("applications")
    .insert({ applicant_user_id: user.id, all_jobs_id: allJobsId, status: "submitted" });
  if (error) return { ok: false, error: "Some error occured while updating the application status. Please try again." };

  return { ok: true };
}
