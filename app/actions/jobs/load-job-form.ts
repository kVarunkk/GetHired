"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { loadJobForm } from "@/helpers/jobs/load-job-form";

const inputSchema = z.object({ jobPostId: z.string().uuid() }).strict();

export type LoadJobFormResult =
  | { ok: true; form: ApplicationForm; answeredQuestionIds: string[] }
  | { ok: false; error: string };

/**
 * SERVER ACTION (AF-REQ-005): a job's full form for the builder: the stored
 * form with its knockout rules (company-only, AF-SEC-003) and the questions
 * that already have answers, so a type change archives them.
 */
export async function loadJobFormAction(input: z.input<typeof inputSchema>): Promise<LoadJobFormResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Job post not found." };
  const { jobPostId } = parsed.data;

  const auth = await requireCompanyForAction({ permission: "jobs.edit", jobId: jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const loaded = await loadJobForm(auth.supabase, auth.company.id, jobPostId);
  if (!loaded) return { ok: false, error: "Job post not found." };
  return { ok: true, ...loaded };
}
