import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { setJobPostStatus } from "@/helpers/jobs/set-job-post-status";
import type { JobPostingInput } from "@/helpers/jobs/job-posting-schema";
import { isEntitlementPayload } from "@/helpers/billing/errors";
import { MAX_JOB_POSTING_QUESTIONS, MAX_JOB_POSTING_QUESTION_CHARS } from "@/helpers/jobs/job-posting-schema";
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
  salaryCurrency: z.string().trim().max(5).describe("Currency symbol, e.g. \"₹\" or \"$\"."),
  minSalary: z.number().min(0).describe("Yearly minimum salary in that currency (0 if not shared)."),
  maxSalary: z.number().min(0).describe("Yearly maximum salary in that currency (0 if not shared)."),
  minExperience: z.number().min(0).max(50).describe("Minimum years of experience."),
  maxExperience: z.number().min(0).max(50).optional().describe("Maximum years of experience."),
  visaSponsorship: z.enum(["Will Sponsor", "Not Required", "Required"]),
  skills: z.array(z.string().trim().min(1).max(100)).max(50).optional().describe("Required skills."),
  questions: z
    .array(z.string().trim().min(1).max(MAX_JOB_POSTING_QUESTION_CHARS))
    .max(MAX_JOB_POSTING_QUESTIONS)
    .optional()
    .describe("Optional screening questions applicants answer when they apply."),
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
  questions: "questions",
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

/** A failed upsert or status change, in the agent's error shape. */
const failure = (error: unknown) =>
  isEntitlementPayload(error)
    ? planLimitError(error)
    : { error: typeof error === "string" ? error : "Couldn't save the job post." };

const EDITABLE_COLUMNS =
  "id, title, description, location, job_type, salary_currency, min_salary, max_salary, min_experience, max_experience, visa_sponsorship, min_equity, max_equity, questions, skills";

export function createJobTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    listMyJobs: tool({
      description:
        "List the company's job posts (active first) with applicant counts and matching status.",
      inputSchema: z.object({
        status: z.enum(["active", "inactive"]).optional(),
        limit: limitInput,
      }),
      execute: ({ status, limit }) =>
        withToolErrors(ctx, "listMyJobs", async () => {
          const jobs = await loadRecruiterJobSummaries(supabase, company.id, {
            status,
            limit: limit ?? AGENT_LIST_DEFAULT_LIMIT,
          });
          return {
            jobs: jobs.map((job) => ({
              id: job.id,
              title: job.title,
              status: job.status,
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
        "Read one of the company's job posts: details, screening questions, matching status and applicants per status.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getJobPost", async () => {
          const { data: job, error } = await supabase
            .from("job_postings")
            .select(
              "id, title, description, location, job_type, salary_currency, min_salary, max_salary, salary_range, min_experience, max_experience, visa_sponsorship, skills, questions, status, matching_status, created_at",
            )
            .eq("id", jobPostId)
            .eq("company_id", company.id)
            .maybeSingle();
          if (error) throw error;
          if (!job) return NOT_FOUND;

          const { data: applications, error: applicationsError } = await supabase
            .from("applications")
            .select("status")
            .eq("job_post_id", job.id);
          if (applicationsError) throw applicationsError;

          const applicantsByStatus: Record<string, number> = {};
          for (const { status } of applications ?? []) {
            applicantsByStatus[status] = (applicantsByStatus[status] ?? 0) + 1;
          }

          return {
            id: job.id,
            title: job.title,
            status: job.status,
            matchingStatus: job.matching_status,
            locations: job.location ?? [],
            jobType: job.job_type,
            salary: formatSalary(job.min_salary, job.max_salary, job.salary_currency) ?? job.salary_range,
            experience: { min: job.min_experience, max: job.max_experience },
            visaSponsorship: job.visa_sponsorship,
            skills: job.skills ?? [],
            questions: job.questions ?? [],
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
        "Create a job post from what the user described. It's saved as inactive (not published); setJobPostStatus publishes it. Write the description yourself from the conversation.",
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
            status: "inactive",
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

          const { data: current, error } = await supabase
            .from("job_postings")
            .select(EDITABLE_COLUMNS)
            .eq("id", jobPostId)
            .eq("company_id", company.id)
            .maybeSingle();
          if (error) throw error;
          if (!current) return NOT_FOUND;

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
            ...toPostingValues(changes),
          };

          const result = await upsertJobPosting(ctx, { values, existingPostingId: current.id });
          if (!result.success) return failure(result.error);
          return { id: current.id, updated: Object.keys(changes), url: jobPostUrl(current.id) };
        }),
    }),

    setJobPostStatus: tool({
      description:
        "Publish (active) or unpublish (inactive) one of the company's job posts. Publishing counts toward the plan's active job post limit.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post"),
        status: z.enum(["active", "inactive"]),
      }),
      execute: ({ jobPostId, status }) =>
        withToolErrors(ctx, "setJobPostStatus", async () => {
          const denied = requireToolPermission(ctx, "jobs.publish", jobPostId);
          if (denied) return denied;
          const result = await setJobPostStatus(ctx, { jobPostingId: jobPostId, status });
          if (!result.ok) return failure(result.error);
          return { id: jobPostId, status, url: jobPostUrl(jobPostId) };
        }),
    }),
  };
}
