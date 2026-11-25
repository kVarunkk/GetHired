import { reportError } from "@/helpers/posthog/report-error";
import { revalidateTag } from "next/cache";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { enqueueIndexPing } from "@/helpers/distribution/index-queue";
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
import { queueJobPostingRelevance } from "@/helpers/profiles/queue-job-relevance";
import type { EntitlementActionError } from "@/helpers/billing/errors";
import { allJobsRowFrom } from "@/helpers/jobs/all-jobs-row";
import { isPublicState, type JobPostState } from "@/helpers/jobs/job-states";
import { jobSnapshotHash, JOB_SNAPSHOT_COLUMNS } from "@/helpers/matching/job-snapshot";
import { markJobResultsStale } from "@/helpers/matching/mark-stale";
import { embedJobs } from "@/helpers/jobs/job-embedding";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import { buildEquityRange, buildExperience } from "@/utils/formatters";
import { setJobPipeline } from "@/helpers/pipeline/pipelines";
import { PIPELINE_NOT_FOUND } from "@/helpers/pipeline/copy";
import { LINK_ONLY_DISABLED, linkOnlyEnabled, type JobVisibility } from "@/helpers/jobs/link-only";
import { closingDateError } from "@/helpers/jobs/closing-date";
import { loadCompanyTimeZone } from "@/helpers/companies/load-time-zone";

export type UpsertJobPostingResult =
  | { success: true; isUpdate: boolean; postingId: string }
  | { success: false; error: string }
  | ({ success: false } & EntitlementActionError);

/**
 * Creates or edits one of `company`'s job postings and keeps its public
 * `all_jobs` row in sync (RS-SEC-001, RS-SEC-002). Shared by the server action
 * and the recruiter agent's job tools. `company` must come from the session;
 * an existing posting is looked up within it with `supabase` (the session's
 * client), and its `job_id` comes from the database.
 *
 * New postings are drafts (D4): no `all_jobs` row and no active-post slot
 * until `setJobPostState` opens them. Editing a draft or a pending job writes
 * no public row, ping, feed rebuild or matching run (JL-REQ-010).
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
      state: JobPostState;
      pipeline_id: string | null;
      closes_at: string | null;
      visibility: JobVisibility;
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
        .select(`id, job_id, state, pipeline_id, closes_at, visibility, ${JOB_SNAPSHOT_COLUMNS}`)
        .eq("id", existingPostingId)
        .eq("company_id", company.id)
        .maybeSingle();
      if (error) throw new Error("Failed to load the job posting.");
      if (!data) return { success: false, error: "Job posting not found." };
      existing = data;
    }

    // JP-REQ-003: checked before anything is written.
    const pipeline = await checkPipeline(supabase, company.id, values.pipeline_id, existing);
    if (!pipeline.ok) return { success: false, error: pipeline.error };

    // JL-REQ-026: a link-only job can't be created before the flag is on.
    if (
      values.visibility === "link_only" &&
      existing?.visibility !== "link_only" &&
      !linkOnlyEnabled()
    ) {
      return { success: false, error: LINK_ONLY_DISABLED };
    }

    // JL-REQ-014: a new closing date is today or later in the company's time
    // zone, and a filled job keeps its own. Clearing is always allowed.
    const closesAtChanged =
      values.closes_at !== undefined && values.closes_at !== (existing?.closes_at ?? null);
    if (closesAtChanged && values.closes_at) {
      const closesAtError = closingDateError({
        next: values.closes_at,
        previous: existing?.closes_at ?? null,
        state: existing?.state,
        timeZone: await loadCompanyTimeZone(supabase, company.id),
      });
      if (closesAtError) return { success: false, error: closesAtError };
    }

    // BL-DEC-007: the limit counts open posts, so neither a new draft nor an
    // edit needs a slot (D4); opening the job checks it.

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
      // "" (no salary) is stored as no currency.
      salary_currency: values.salary_currency || null,
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
      ...(values.openings !== undefined ? { openings: values.openings } : {}),
      // reset_job_closing_reminder gives a moved date its own reminder (JL-REQ-017).
      ...(values.visibility !== undefined ? { visibility: values.visibility } : {}),
      ...(closesAtChanged ? { closes_at: values.closes_at } : {}),
      salary_range,
      equity_range,
      experience,
      updated_at: new Date().toISOString(),
    };

    // A job with no applications moves through set_job_pipeline (the job
    // trigger refuses a direct pipeline_id update), as the session user, so the
    // RPC checks jobs.edit itself. Before the save, so a refusal saves nothing.
    if (existing && pipeline.switchTo) {
      const switched = await setJobPipeline(
        { supabase, company },
        { jobPostId: existing.id, pipelineId: pipeline.switchTo },
      );
      if (!switched.ok) return { success: false, error: switched.error };
    }

    // Ownership is settled above; the service role is only used from here on.
    const service = createServiceRoleClient();

    const write = existing
      ? service
          .from("job_postings")
          .update(payload)
          .eq("id", existing.id)
          .eq("company_id", company.id)
      : service
          .from("job_postings")
          .insert({ ...payload, ...(pipeline.switchTo ? { pipeline_id: pipeline.switchTo } : {}) });
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
      if (assignError) reportError(`[job posting] couldn't assign the creator to ${posting.id}`, assignError);
    }

    // MT-REQ-008: an edit to what screening reads makes old results stale.
    // Done inline, before the relevance re-run below starts: the digest
    // re-queues the explanations it reads as stale, so marking them after its
    // read would leave them stale until the next run.
    if (existing && jobSnapshotHash(existing) !== jobSnapshotHash(posting)) {
      try {
        await markJobResultsStale(service, posting.id);
      } catch (err) {
        reportError(`[job posting] couldn't re-screen ${posting.id}`, err);
      }
    }

    // An edit is embedded now, not by the queue, so the matching run queued
    // below ranks against the new text. The insert triggers queue new rows.
    const embedding = existing ? await embedEditedPosting(service, posting) : null;

    // A draft or pending job has no public row (D4), or one that isn't listed
    // yet; ensurePublicJobRow brings it up to date when the job first opens.
    const isPublic = isPublicState(posting.state);

    if (existing?.job_id && isPublic) {
      const { error: updateError } = await service
        .from("all_jobs")
        .update({
          ...allJobsRowFrom(posting),
          updated_at: new Date().toISOString(),
          ...(embedding ? { embedding_new: embedding } : {}),
        })
        .eq("id", existing.job_id);

      if (updateError) throw new Error("Failed to update public job feed.");

      revalidateTag(`job-${existing.job_id}`);
    }

    // Couldn't embed inline: the scheduled worker re-embeds both rows instead.
    if (existing && !embedding) {
      await queueJobEmbeddings(service, [
        { id: posting.id, table: "job_postings" },
        ...(existing.job_id && isPublic ? [{ id: existing.job_id, table: "all_jobs" as const }] : []),
      ]);
    }

    // CP-CON-001: the careers page lists the company's active jobs.
    if (isPublic) revalidateTag(careersCompanyTag(company.id));

    if (posting.state === "open") {
      if (existing?.job_id) await enqueueIndexPing({ jobId: existing.job_id, reason: "updated" });
      await enqueueFeedRebuild();
      await queueJobPostingRelevance({ supabase, company, user }, posting.id);
    }

    return { success: true, isUpdate, postingId: posting.id };
  } catch (error: unknown) {
    reportError("[job posting] save failed", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error occurred while processing job post.",
    };
  }
}

/** JPT-034: an edit can't move a job's candidates; the switch page maps their stages. */
export const PIPELINE_HAS_APPLICATIONS =
  "This job has applications. Change its pipeline from the job's Pipeline section, which moves them.";

/**
 * Checks a requested pipeline: one of the company's active pipelines, and on
 * an edit, only for a job with no applications (merged ones count: a switch
 * moves them too). `switchTo` is the pipeline to write, or null for none.
 */
async function checkPipeline(
  supabase: SupabaseClient<Database>,
  companyId: string,
  pipelineId: string | undefined,
  existing: { id: string; pipeline_id: string | null } | null,
): Promise<{ ok: true; switchTo: string | null } | { ok: false; error: string }> {
  if (!pipelineId || pipelineId === existing?.pipeline_id) return { ok: true, switchTo: null };

  const { data, error } = await supabase
    .from("company_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("company_id", companyId)
    .eq("archived", false)
    .maybeSingle();
  if (error) throw new Error("Failed to load the pipeline.");
  if (!data) return { ok: false, error: PIPELINE_NOT_FOUND };

  if (existing) {
    const { count, error: countError } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("job_post_id", existing.id);
    if (countError) throw new Error("Failed to count the job's applications.");
    if ((count ?? 0) > 0) return { ok: false, error: PIPELINE_HAS_APPLICATIONS };
  }
  return { ok: true, switchTo: data.id };
}

/** The pgmq queue `/api/update-embedding/gemini/job` drains every 5 minutes. */
const JOB_EMBEDDINGS_QUEUE = "job_embeddings_queue";

/**
 * Queues each row for a new embedding. A failure is reported, not thrown: the
 * edit is already saved, and the old embedding still matches it roughly.
 */
async function queueJobEmbeddings(
  service: SupabaseClient<Database>,
  rows: { id: string; table: "job_postings" | "all_jobs" }[],
) {
  for (const row of rows) {
    const { error } = await service.schema("pgmq_public").rpc("send", {
      queue_name: JOB_EMBEDDINGS_QUEUE,
      message: row,
      sleep_seconds: 0,
    });
    if (error) reportError(`[job posting] couldn't queue the ${row.table} embedding for ${row.id}`, error);
  }
}

/**
 * Embeds an edited posting and saves it on the posting, returning the vector
 * for its `all_jobs` row, or null if either step failed (reported, not thrown:
 * the edit is already saved).
 */
async function embedEditedPosting(
  service: SupabaseClient<Database>,
  posting: {
    id: string;
    title: string;
    description: string | null;
    location: string[] | null;
    job_type: string | null;
    salary_range: string | null;
  },
): Promise<string | null> {
  try {
    const [embedding] = await embedJobs([
      {
        job_name: posting.title,
        description: posting.description,
        locations: posting.location,
        job_type: posting.job_type,
        salary_range: posting.salary_range,
      },
    ]);
    const now = new Date().toISOString();
    const { error } = await service
      .from("job_postings")
      .update({ embedding_new: embedding, embedding_updated_at: now })
      .eq("id", posting.id);
    if (error) throw new Error(error.message);
    return embedding;
  } catch (err) {
    reportError(`[job posting] couldn't embed ${posting.id}`, err);
    return null;
  }
}
