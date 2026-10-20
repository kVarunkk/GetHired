import { revalidateTag } from "next/cache";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import {
  jobPostingInputSchema,
  type JobPostingInput,
} from "@/helpers/jobs/job-posting-schema";
import { formFromLegacyQuestions, legacyQuestionsOf } from "@/helpers/jobs/application-form-schema";
import { screenFormFairness } from "@/helpers/jobs/form-fairness";
import { splitForm } from "@/helpers/jobs/public-application-form";
import type { Json } from "@/utils/types/database.types";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";
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

export type UpsertJobPostingResult =
  | { success: true; isUpdate: boolean; postingId: string }
  | { success: false; error: string }
  | ({ success: false } & EntitlementActionError);

/**
 * Creates or edits one of `company`'s job postings and keeps its public
 * `all_jobs` row in sync (RS-SEC-001, RS-SEC-002). Shared by the server action
 * and the recruiter agent's job tools. `company` must come from the session;
 * an existing posting is looked up within it with `supabase` (the session's
 * client), and its `job_id` comes from the database. New postings are inactive.
 */
export async function upsertJobPosting(
  {
    supabase,
    company,
    user,
  }: { supabase: SupabaseClient<Database>; company: MyCompany; user?: { id: string } },
  params: { values: JobPostingInput; existingPostingId?: string },
): Promise<UpsertJobPostingResult> {
  const parsed = jobPostingInputSchema.safeParse(params.values);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid job posting.",
    };
  }
  const values = parsed.data;

  // AF-REQ-001 / AF-CON-001: the typed form, or one built from the old questions.
  const fullForm = values.application_form ?? formFromLegacyQuestions(values.questions);
  const fairness = screenFormFairness(fullForm);
  if (!fairness.ok) return { success: false, error: fairness.error };
  const { stored: storedForm, rules: formRules } = splitForm(fullForm);

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
      questions: legacyQuestionsOf(fullForm),
      application_form: storedForm as unknown as Json,
      ...(values.department !== undefined ? { department: values.department } : {}),
      ...(values.workplace_type !== undefined ? { workplace_type: values.workplace_type } : {}),
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

    // AF-SEC-003: the knockout rules live apart from the world-readable posting.
    const { error: rulesError } = await service.from("job_posting_form_rules").upsert({
      job_post_id: posting.id,
      company_id: company.id,
      rules: formRules as unknown as Json,
      updated_at: new Date().toISOString(),
    });
    if (rulesError) throw new Error("Failed to save the application form.");

    // RP-REQ-011: the creator is assigned to a new job, so a job-scoped role
    // with jobs.create can manage what it creates. Owners see every job.
    if (!existing && user && !company.isOwner) {
      const { error: assignError } = await service.rpc("assign_job_creator", {
        p_job_post_id: posting.id,
        p_user_id: user.id,
      });
      if (assignError) console.error(`[job posting] couldn't assign the creator to ${posting.id}`, assignError);
    }

    // MT-REQ-008: an edit to what screening reads makes old results stale.
    // Done inline, before the relevance re-run below starts: the digest writes
    // each row's explanation_status back, so marking stale in the background
    // could race it and leave an explanation of the old job "completed".
    if (existing && jobSnapshotHash(existing) !== jobSnapshotHash(posting)) {
      try {
        await markJobResultsStale(service, posting.id);
      } catch (err) {
        console.error(`[job posting] couldn't re-screen ${posting.id}`, err);
      }
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

    // CP-CON-001: the careers page lists the company's active jobs.
    revalidateTag(careersCompanyTag(company.id));

    if (posting.status === "active") {
      await triggerJobPostingRelevanceUpdate(posting.id);
    }

    return { success: true, isUpdate, postingId: posting.id };
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
