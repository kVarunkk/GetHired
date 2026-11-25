import { tool } from "ai";
import { currencyCodeSchema } from "@/helpers/currency/currencies";
import { applicationFormSchema, readApplicationForm, type ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { loadAnsweredQuestionIds } from "@/helpers/jobs/load-job-form";
import { keepAnsweredQuestions } from "@/helpers/jobs/question-sets";
import { withRules } from "@/helpers/jobs/public-application-form";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { setJobPostState } from "@/helpers/jobs/set-job-post-state";
import { cancelOpenScreeningInterviews } from "@/helpers/jobs/job-interviews";
import { countHiresFor, shouldSuggestFill } from "@/helpers/jobs/job-hires";
import {
  CLOSE_REASONS,
  JOB_POST_STATES,
  REVIEW_DECISIONS,
  REVIEW_DECISION_STATE,
  STATE_NOTE_MAX,
} from "@/helpers/jobs/job-states";
import { JOB_STATE_REFUSALS } from "@/helpers/jobs/job-state-copy";
import { deleteJobPost } from "@/helpers/jobs/delete-job-post";
import type { JobPostingInput } from "@/helpers/jobs/job-posting-schema";
import { closingDateSchema } from "@/helpers/jobs/closing-date";
import { isEntitlementPayload } from "@/helpers/billing/errors";
import {
  MAX_JOB_POSTING_QUESTIONS,
  MAX_JOB_POSTING_QUESTION_CHARS,
  MAX_OPENINGS,
  MIN_OPENINGS,
} from "@/helpers/jobs/job-posting-schema";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
import { loadRecruiterJobSummaries } from "../context";
import { RA_JOB_DESCRIPTION_MAX_CHARS } from "../config";
import {
  fairnessError,
  formatSalary,
  jobPostUrl,
  limitInput,
  planLimitError,
  requireToolPermission,
  type RecruiterToolContext,
  uuidInput,
  withToolErrors,
} from "./shared";

const NOT_FOUND = { error: "Job post not found." } as const;

/**
 * RP-REQ-031: creating, editing and closing jobs need jobs.create / jobs.edit
 * (scoped to the job). RLS refuses the write too; the tool answers first,
 * with a message the model can pass on.
 */

/** A job post's fields, as the model writes them (camelCase, described). */
const jobPostFields = {
  title: z.string().trim().min(1).max(200).describe("The job title, e.g. \"Senior Backend Engineer\"."),
  description: z
    .string()
    .trim()
    .min(1)
    .max(20000)
    .describe("The full job description in markdown: the role, responsibilities, requirements and what the company offers."),
  locations: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(20)
    .describe("Cities, or \"Remote\"."),
  jobType: z.enum(["Fulltime", "Intern", "Contract"]),
  salaryCurrency: currencyCodeSchema.describe("ISO 4217 code of the salary's currency, e.g. INR, USD, EUR, GBP, SGD, AED."),
  minSalary: z.number().min(0).describe("Yearly minimum salary in that currency (0 if not shared)."),
  maxSalary: z.number().min(0).describe("Yearly maximum salary in that currency (0 if not shared)."),
  minExperience: z.number().min(0).max(50).describe("Minimum years of experience."),
  maxExperience: z.number().min(0).max(50).optional().describe("Maximum years of experience."),
  visaSponsorship: z.enum(["Will Sponsor", "Not Required", "Required"]),
  skills: z.array(z.string().trim().min(1).max(100)).max(50).optional().describe("Required skills."),
  department: z.string().trim().max(60).optional().describe("Optional department, e.g. \"Engineering\". Groups jobs on the careers page."),
  workplaceType: z.enum(["onsite", "hybrid", "remote"]).optional().describe("Optional: on-site, hybrid or remote."),
  openings: z
    .number()
    .int()
    .min(MIN_OPENINGS)
    .max(MAX_OPENINGS)
    .optional()
    .describe("How many people the job hires (default 1)."),
  closesAt: closingDateSchema
    .nullable()
    .optional()
    .describe(
      "Optional closing date, YYYY-MM-DD, today or later in the company's time zone. The job closes itself at the end of that day. null clears it.",
    ),
  visibility: z
    .enum(["public", "link_only"])
    .optional()
    .describe(
      "Who can find the job: public (job board, search, careers page, job sites) or link_only (open, but only people with the link; kept out of every listing). Only when the user asks.",
    ),
  questions: z
    .array(z.string().trim().min(1).max(MAX_JOB_POSTING_QUESTION_CHARS))
    .max(MAX_JOB_POSTING_QUESTIONS)
    .optional()
    .describe("Optional plain-text screening questions (each required, long answer). Use applicationForm for typed questions."),
  applicationForm: applicationFormSchema
    .optional()
    .describe(
      "Optional typed application form: questions (short_text, long_text, single_select, multi_select, yes_no, number, date, url; each with a uuid id, label and required flag, options for choices), standard_fields (phone, linkedin_url, portfolio_url, current_location, expected_salary, notice_period_days, earliest_start_date, work_authorization, cover_letter: off/optional/required) and optional knockout rules. Replaces questions.",
    ),
};

type JobPostFields = {
  [K in keyof typeof jobPostFields]?: z.infer<(typeof jobPostFields)[K]>;
};

/** camelCase tool input → the posting schema's snake_case fields. */
const FIELD_MAP = {
  title: "title",
  description: "description",
  locations: "location",
  jobType: "job_type",
  salaryCurrency: "salary_currency",
  minSalary: "min_salary",
  maxSalary: "max_salary",
  minExperience: "min_experience",
  maxExperience: "max_experience",
  visaSponsorship: "visa_sponsorship",
  skills: "skills",
  department: "department",
  workplaceType: "workplace_type",
  openings: "openings",
  closesAt: "closes_at",
  visibility: "visibility",
  questions: "questions",
  applicationForm: "application_form",
} as const satisfies Record<keyof typeof jobPostFields, keyof JobPostingInput>;

function toPostingValues(fields: JobPostFields): Partial<JobPostingInput> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [FIELD_MAP[key as keyof typeof FIELD_MAP], value]),
  ) as Partial<JobPostingInput>;
}

/** Job posts may describe the company, but not exclude people (RA-SEC-004). */
const jobPostFairness = (fields: JobPostFields) =>
  fairnessError([fields.title, fields.description, ...(fields.questions ?? [])], "job_post");

/** A failed upsert or state change, in the agent's error shape. */
const failure = (error: unknown) =>
  isEntitlementPayload(error)
    ? planLimitError(error)
    : { error: typeof error === "string" ? error : "Couldn't save the job post." };

const EDITABLE_COLUMNS =
  "id, title, description, location, job_type, salary_currency, min_salary, max_salary, min_experience, max_experience, visa_sponsorship, min_equity, max_equity, questions, application_form, skills, department, workplace_type";

/**
 * Saves `changes` onto one of the company's job posts: the current values are
 * read and merged, because the posting schema takes a whole post. The typed
 * form and its rules are kept unless `changes` replaces them (AF-REQ-001); a
 * replaced form keeps the answered questions it drops, archived (AF-REQ-005).
 * The caller checks jobs.edit and fairness first.
 */
export async function updateJobPostValues(
  ctx: RecruiterToolContext,
  jobPostId: string,
  changes: Partial<JobPostingInput>,
): Promise<{ id: string; url: string } | { error: string }> {
  const { supabase, company } = ctx;
  const { data: current, error } = await supabase
    .from("job_postings")
    .select(EDITABLE_COLUMNS)
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error) throw error;
  if (!current) return NOT_FOUND;

  let application_form: JobPostingInput["application_form"];
  if (changes.questions === undefined && changes.application_form === undefined) {
    const { data: ruleRow } = await supabase
      .from("job_posting_form_rules")
      .select("rules")
      .eq("job_post_id", current.id)
      .maybeSingle();
    application_form = withRules(readApplicationForm(current.application_form, current.questions), ruleRow?.rules ?? null);
  } else if (changes.application_form) {
    application_form = keepAnsweredQuestions(
      readApplicationForm(current.application_form, current.questions),
      changes.application_form as ApplicationForm,
      await loadAnsweredQuestionIds(supabase, current.id),
    );
  }

  const values: JobPostingInput = {
    title: current.title,
    description: current.description ?? "",
    location: current.location ?? [],
    job_type: current.job_type as JobPostingInput["job_type"],
    salary_currency: current.salary_currency ?? "",
    min_salary: current.min_salary ?? 0,
    max_salary: current.max_salary ?? 0,
    min_experience: current.min_experience ?? 0,
    ...(current.max_experience !== null ? { max_experience: current.max_experience } : {}),
    visa_sponsorship: current.visa_sponsorship as JobPostingInput["visa_sponsorship"],
    ...(current.min_equity !== null ? { min_equity: current.min_equity } : {}),
    ...(current.max_equity !== null ? { max_equity: current.max_equity } : {}),
    questions: current.questions ?? [],
    ...(current.skills ? { skills: current.skills } : {}),
    // The schema turns a missing department into null, which would clear it.
    ...(current.department ? { department: current.department } : {}),
    ...(current.workplace_type ? { workplace_type: current.workplace_type } : {}),
    ...changes,
    ...(application_form ? { application_form } : {}),
  };

  const result = await upsertJobPosting(ctx, { values, existingPostingId: current.id });
  if (!result.success) return failure(result.error);
  return { id: current.id, url: jobPostUrl(current.id) };
}

export function createJobTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    listMyJobs: tool({
      description:
        "List the company's job posts (open first, then drafts) with their state, hires against openings, applicant counts and matching status. Filter by state: draft, pending_approval (waiting for approval), open, paused, closed or filled.",
      inputSchema: z.object({
        states: z.array(z.enum(JOB_POST_STATES)).min(1).max(JOB_POST_STATES.length).optional(),
        limit: limitInput,
      }),
      execute: ({ states, limit }) =>
        withToolErrors(ctx, "listMyJobs", async () => {
          const jobs = await loadRecruiterJobSummaries(supabase, company.id, {
            states,
            limit: limit ?? AGENT_LIST_DEFAULT_LIMIT,
          });
          return {
            jobs: jobs.map((job) => ({
              id: job.id,
              title: job.title,
              state: job.state,
              openings: job.openings,
              hires: job.hires,
              closesAt: job.closes_at,
              matchingStatus: job.matching_status,
              applicants: job.applicants,
              newInLast24h: job.new_24h,
              url: jobPostUrl(job.id),
            })),
          };
        }),
    }),

    getJobPost: tool({
      description:
        "Read one of the company's job posts: details, its state, openings and hires, closing date, its application form (questions, standard fields and knockout rules), matching status and applicants per status.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getJobPost", async () => {
          const { data: job, error } = await supabase
            .from("job_postings")
            .select(
              "id, title, description, location, job_type, salary_currency, min_salary, max_salary, salary_range, min_experience, max_experience, visa_sponsorship, skills, questions, application_form, department, workplace_type, status, state, visibility, openings, closes_at, matching_status, created_at",
            )
            .eq("id", jobPostId)
            .eq("company_id", company.id)
            .maybeSingle();
          if (error) throw error;
          if (!job) return NOT_FOUND;

          const [{ data: applications, error: applicationsError }, { data: ruleRow }, hires] = await Promise.all([
            supabase.from("applications").select("status").eq("job_post_id", job.id),
            supabase.from("job_posting_form_rules").select("rules").eq("job_post_id", job.id).maybeSingle(),
            countHiresFor(supabase, job.id),
          ]);
          if (applicationsError) throw applicationsError;

          const applicantsByStatus: Record<string, number> = {};
          for (const { status } of applications ?? []) {
            applicantsByStatus[status] = (applicantsByStatus[status] ?? 0) + 1;
          }

          return {
            id: job.id,
            title: job.title,
            state: job.state,
            visibility: job.visibility,
            openings: job.openings,
            hires,
            // D5: a hint for the model to offer "Mark as filled"; nothing changes by itself.
            ...(shouldSuggestFill(job, hires) ? { suggestFill: true } : {}),
            closesAt: job.closes_at,
            matchingStatus: job.matching_status,
            locations: job.location ?? [],
            jobType: job.job_type,
            salary: formatSalary(job.min_salary, job.max_salary, job.salary_currency) ?? job.salary_range,
            experience: { min: job.min_experience, max: job.max_experience },
            visaSponsorship: job.visa_sponsorship,
            skills: job.skills ?? [],
            department: job.department,
            workplaceType: job.workplace_type,
            // The typed form with its knockout rules (company-only, AF-SEC-003).
            applicationForm: withRules(readApplicationForm(job.application_form, job.questions), ruleRow?.rules ?? null),
            // The team may paste third-party text into a description.
            description: wrapInSandbox(
              "job_description",
              (job.description ?? "").slice(0, RA_JOB_DESCRIPTION_MAX_CHARS),
            ),
            applicantsByStatus,
            postedAt: job.created_at,
            url: jobPostUrl(job.id),
          };
        }),
    }),

    createJobPost: tool({
      description:
        "Create a job post from what the user described. It's saved as a draft, not published and not visible to applicants; setJobPostState with state open publishes it. Write the description yourself from the conversation. Before calling it, offer the optional parts the user hasn't covered (screening questions, application fields, knockout rules) and include what they choose in this call.",
      inputSchema: z.object(jobPostFields).strict(),
      execute: (fields) =>
        withToolErrors(ctx, "createJobPost", async () => {
          const denied = requireToolPermission(ctx, "jobs.create");
          if (denied) return denied;
          const unfair = jobPostFairness(fields);
          if (unfair) return unfair;

          const result = await upsertJobPosting(ctx, {
            values: toPostingValues(fields) as JobPostingInput,
          });
          if (!result.success) return failure(result.error);
          return {
            id: result.postingId,
            title: fields.title,
            state: "draft",
            url: jobPostUrl(result.postingId),
          };
        }),
    }),

    updateJobPost: tool({
      description:
        "Edit one of the company's job posts. Pass only the fields to change. Editing the title, description, skills or experience marks existing matches and screenings stale.",
      inputSchema: z
        .object({ jobPostId: uuidInput("job post"), ...z.object(jobPostFields).partial().shape })
        .strict()
        .refine((input) => Object.keys(input).some((key) => key !== "jobPostId"), {
          message: "Pass at least one field to change.",
        }),
      execute: ({ jobPostId, ...changes }) =>
        withToolErrors(ctx, "updateJobPost", async () => {
          const denied = requireToolPermission(ctx, "jobs.edit", jobPostId);
          if (denied) return denied;
          const unfair = jobPostFairness(changes);
          if (unfair) return unfair;

          const result = await updateJobPostValues(ctx, jobPostId, toPostingValues(changes));
          if ("error" in result) return result;
          return { id: result.id, updated: Object.keys(changes), url: result.url };
        }),
    }),

    setJobPostState: tool({
      description:
        "Move one of the company's job posts to another state: open (publish a draft, resume a paused job or reopen a closed or filled one; counts toward the plan's active job post limit), paused (stops applications for now), closed (needs a reason: cancelled, on_hold_indefinitely or other) or filled. With approval on, a user who can't approve submits a draft with submitJobForApproval instead, and a job waiting for approval is approved or sent back with reviewJobApproval. A note is for the team only. cancelOpenInterviews (close or fill only) also cancels the job's open AI screening interviews; only when the user asked for it.",
      inputSchema: z
        .object({
          jobPostId: uuidInput("job post"),
          state: z.enum(JOB_POST_STATES),
          reason: z.enum(CLOSE_REASONS).optional().describe("Required to close: why the job is closing."),
          note: z.string().trim().max(STATE_NOTE_MAX).optional().describe("Optional note for the team, kept with the change."),
          cancelOpenInterviews: z.boolean().optional(),
        })
        .strict(),
      execute: ({ jobPostId, state, reason, note, cancelOpenInterviews }) =>
        withToolErrors(ctx, "setJobPostState", async () => {
          const denied = requireToolPermission(ctx, "jobs.publish", jobPostId);
          if (denied) return denied;
          const result = await setJobPostState(
            { ...ctx, actorKind: "agent" },
            { jobPostId, to: state, reason: reason ?? null, note: note ?? null },
          );
          if (!result.ok) return failure(result.error);

          let interviews: { cancelled: number } | { error: string } | undefined;
          if (cancelOpenInterviews && result.changed && (state === "closed" || state === "filled")) {
            const cancelled = await cancelOpenScreeningInterviews(ctx, jobPostId);
            interviews = cancelled.ok ? { cancelled: cancelled.cancelled } : { error: cancelled.error };
          }
          return {
            id: jobPostId,
            state: result.state,
            changed: result.changed,
            ...(interviews ? { interviews } : {}),
            url: jobPostUrl(jobPostId),
          };
        }),
    }),

    // JL-REQ-031: approval before a job opens, when the company requires it.
    submitJobForApproval: tool({
      description:
        "Submit a draft job post for approval, when the company requires approval before a job opens and the user can't approve it themselves (setJobPostState open answers that approval is needed). An approver is emailed. A note is for the approver only.",
      inputSchema: z
        .object({
          jobPostId: uuidInput("job post"),
          note: z.string().trim().max(STATE_NOTE_MAX).optional().describe("Optional note for the approver."),
        })
        .strict(),
      execute: ({ jobPostId, note }) =>
        withToolErrors(ctx, "submitJobForApproval", async () => {
          const denied = requireToolPermission(ctx, "jobs.publish", jobPostId);
          if (denied) return denied;
          const result = await setJobPostState(
            { ...ctx, actorKind: "agent" },
            { jobPostId, to: "pending_approval", note: note ?? null, from: ["draft"] },
          );
          if (!result.ok) return failure(result.error);
          return { id: jobPostId, state: result.state, changed: result.changed, url: jobPostUrl(jobPostId) };
        }),
    }),

    reviewJobApproval: tool({
      description:
        "Review a job post that's waiting for approval: approve opens it to applicants (counts toward the plan's active job post limit); request_changes sends it back to a draft and needs a note saying what to change, which the submitter is emailed. Only when the user decided.",
      inputSchema: z
        .object({
          jobPostId: uuidInput("job post"),
          decision: z.enum(REVIEW_DECISIONS),
          note: z
            .string()
            .trim()
            .max(STATE_NOTE_MAX)
            .optional()
            .describe("What to change; required for request_changes. Sent to the submitter."),
        })
        .strict(),
      execute: ({ jobPostId, decision, note }) =>
        withToolErrors(ctx, "reviewJobApproval", async () => {
          const denied = requireToolPermission(ctx, "jobs.approve", jobPostId);
          if (denied) return denied;
          if (decision === "request_changes" && !note) return failure(JOB_STATE_REFUSALS.note_required);
          const result = await setJobPostState(
            { ...ctx, actorKind: "agent" },
            { jobPostId, to: REVIEW_DECISION_STATE[decision], note: note ?? null, from: ["pending_approval"] },
          );
          if (!result.ok) return failure(result.error);
          return { id: jobPostId, decision, state: result.state, changed: result.changed, url: jobPostUrl(jobPostId) };
        }),
    }),

    deleteJobPost: tool({
      description:
        "Permanently delete one of the company's job posts, with its applications and its public listing. Only when the user asked to delete it; to take a job down, setJobPostState paused or closed instead.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "deleteJobPost", async () => {
          const denied = requireToolPermission(ctx, "jobs.delete", jobPostId);
          if (denied) return denied;
          const result = await deleteJobPost(ctx, { jobPostingId: jobPostId });
          if (!result.ok) return { error: result.error };
          return { id: jobPostId, title: result.title, deleted: true };
        }),
    }),
  };
}
