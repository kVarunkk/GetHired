"use server";

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import {
  jobPostingInputSchema,
  type JobPostingInput,
} from "@/helpers/jobs/job-posting-schema";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";
import { assertLimit } from "@/helpers/billing/entitlements";
import {
  EntitlementError,
  toEntitlementActionError,
  type EntitlementActionError,
} from "@/helpers/billing/errors";
import { jobSnapshotHash, JOB_SNAPSHOT_COLUMNS } from "@/helpers/matching/job-snapshot";
import { markJobResultsStale } from "@/helpers/matching/mark-stale";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import {
  buildEquityRange,
  buildExperience,
  deploymentUrl,
  INTERNAL_API_SECRET,
} from "@/utils/formatters";

type UpsertResult =
  | { success: true; isUpdate: boolean }
  | { success: false; error: string }
  | ({ success: false } & EntitlementActionError);

/**
 * SERVER ACTION: creates or edits one of the session company's job postings and
 * keeps its public `all_jobs` row in sync (RS-SEC-001, RS-SEC-002). The company
 * always comes from the session; an existing posting is looked up within that
 * company, and its `job_id` comes from the database. New postings are inactive.
 */
export async function upsertJobPostingAction(params: {
  values: JobPostingInput;
  existingPostingId?: string;
}): Promise<UpsertResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const { supabase, company } = auth;

  const parsed = jobPostingInputSchema.safeParse(params.values);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid job posting.",
    };
  }
  const values = parsed.data;

  const { existingPostingId } = params;
  const isUpdate = existingPostingId !== undefined;

  try {
    let existing: {
      id: string;
      job_id: string | null;
      title: string;
      description: string | null;
      skills: string[] | null;
      min_experience: number | null;
      max_experience: number | null;
    } | null = null;
    if (isUpdate) {
      if (!isUuid(existingPostingId)) {
        return { success: false, error: "Job posting not found." };
      }
      const { data, error } = await supabase
        .from("job_postings")
        .select(`id, job_id, ${JOB_SNAPSHOT_COLUMNS}`)
        .eq("id", existingPostingId)
        .eq("company_id", company.id)
        .maybeSingle();
      if (error) throw new Error("Failed to load the job posting.");
      if (!data) return { success: false, error: "Job posting not found." };
      existing = data;
    }

    // BL-DEC-007: the limit counts active posts. Edits never need a slot.
    if (!existing) {
      try {
        await assertLimit(company.id, "active_job_posts");
      } catch (err) {
        if (err instanceof EntitlementError) {
          return { success: false, ...toEntitlementActionError(err) };
        }
        throw err;
      }
    }

    const salary_range = buildSalaryRange(
      values.min_salary,
      values.max_salary,
      values.salary_currency,
    );
    const equity_range = buildEquityRange(values.min_equity, values.max_equity);
    const experience = buildExperience(
      values.min_experience,
      values.max_experience,
    );

    // Built field by field from the parsed input: nothing from the client is spread.
    const payload = {
      company_id: company.id,
      title: values.title,
      description: values.description,
      location: values.location,
      job_type: values.job_type,
      salary_currency: values.salary_currency,
      min_salary: values.min_salary,
      max_salary: values.max_salary,
      min_experience: values.min_experience,
      max_experience: values.max_experience,
      visa_sponsorship: values.visa_sponsorship,
      min_equity: values.min_equity,
      max_equity: values.max_equity,
      questions: values.questions,
      ...(values.skills ? { skills: values.skills } : {}),
      salary_range,
      equity_range,
      experience,
      updated_at: new Date().toISOString(),
    };

    // Ownership is settled above; the service role is only used from here on.
    const service = createServiceRoleClient();

    const write = existing
      ? service
          .from("job_postings")
          .update(payload)
          .eq("id", existing.id)
          .eq("company_id", company.id)
      : service.from("job_postings").insert(payload);
    const { data: posting, error: postingError } = await write
      .select("*, company_info(website, name, id)")
      .single();

    if (postingError || !posting) throw new Error("Failed to save the job posting.");

    // MT-REQ-008: an edit to what screening reads makes old results stale.
    if (existing && jobSnapshotHash(existing) !== jobSnapshotHash(posting)) {
      const jobPostId = posting.id;
      after(async () => {
        try {
          await markJobResultsStale(service, jobPostId);
        } catch (err) {
          console.error(`[job posting] couldn't re-screen ${jobPostId}`, err);
        }
      });
    }

    let embedding = null;
    if (existing) {
      const embeddingResult = await fetch(
        `${deploymentUrl()}/api/update-embedding/gemini/job`,
        {
          method: "POST",
          headers: {
            "X-Internal-Secret": INTERNAL_API_SECRET,
          },
          body: JSON.stringify({
            id: existing.id,
            job_name: values.title,
            locations: values.location,
            description: values.description,
            job_type: values.job_type,
            salary_range,
            table: "job_postings",
          }),
        },
      );

      if (!embeddingResult.ok) {
        const errorData = await embeddingResult.json();
        return { success: false, error: errorData.error };
      }

      embedding = (await embeddingResult.json()).data;
    }

    if (existing?.job_id) {
      const { error: updateError } = await service
        .from("all_jobs")
        .update({
          job_name: values.title,
          job_type: values.job_type,
          salary_range,
          salary_min: values.min_salary,
          salary_max: values.max_salary,
          experience,
          experience_min: values.min_experience,
          experience_max: values.max_experience,
          equity_range,
          equity_min: values.min_equity,
          equity_max: values.max_equity,
          visa_requirement: values.visa_sponsorship,
          description: values.description,
          locations: values.location,
          updated_at: new Date().toISOString(),
          embedding_new: embedding,
        })
        .eq("id", existing.job_id);

      if (updateError) throw new Error("Failed to update public job feed.");

      revalidateTag(`job-${existing.job_id}`);
    } else if (!posting.job_id) {
      // Create the public entry for the first time.
      const { data: insertedJob, error: insertError } = await service
        .from("all_jobs")
        .insert({
          locations: posting.location,
          job_type: posting.job_type,
          job_name: posting.title,
          description: posting.description,
          visa_requirement: posting.visa_sponsorship,
          salary_range: posting.salary_range,
          salary_min: posting.min_salary,
          salary_max: posting.max_salary,
          experience_min: posting.min_experience ?? undefined,
          experience_max: posting.max_experience,
          equity_range: posting.equity_range,
          equity_min: posting.min_equity,
          equity_max: posting.max_equity,
          experience: posting.experience,
          company_url: "/companies/" + company.id,
          company_name: posting.company_info?.name ?? company.name,
          platform: "gethired",
          status: "inactive",
          is_platform_job: true,
        })
        .select("id")
        .single();

      if (insertError || !insertedJob) throw new Error("Failed to publish the job posting.");

      // Map the new public job_id back to our internal posting.
      await service
        .from("job_postings")
        .update({ job_id: insertedJob.id })
        .eq("id", posting.id);
    }

    if (posting.status === "active") {
      await triggerJobPostingRelevanceUpdate(posting.id);
    }

    return { success: true, isUpdate };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error occurred while processing job post.",
    };
  }
}
