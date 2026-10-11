import { after } from "next/server";
import { tool } from "ai";
import { z } from "zod";
import {
  searchJobs,
  SearchJobsParams,
  SearchJobsResult,
} from "@/helpers/jobs/search-jobs";
import { JobQueryFilters, parseJobQuery } from "@/helpers/jobs/parse-job-query";
import { validateAndSanitizeSearchQuery } from "@/helpers/ai/security";
import { platformsArray } from "@/utils/platforms";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import {
  AGENT_JOB_DESCRIPTION_MAX_CHARS,
  AGENT_LIST_DEFAULT_LIMIT,
} from "../config";
import {
  AgentToolContext,
  compactJob,
  INSUFFICIENT_CREDITS,
  limitInput,
  uuidInput,
  withToolErrors,
} from "./shared";

const PLATFORMS = platformsArray.map((platform) => platform.value) as [
  string,
  ...string[],
];

const jobFiltersInput = z.object({
  keywords: z
    .array(z.string().min(1).max(50))
    .max(10)
    .optional()
    .describe(
      "Job title keywords, including common variants, e.g. ['frontend', 'front-end', 'front end'].",
    ),
  locations: z
    .array(z.string().min(1).max(60))
    .max(10)
    .optional()
    .describe("Locations, e.g. ['Remote', 'Bengaluru']."),
  jobTypes: z.array(z.enum(["Fulltime", "Contract", "Intern"])).optional(),
  minSalary: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Minimum salary as a plain integer."),
  minExperience: z
    .number()
    .int()
    .min(0)
    .max(30)
    .optional()
    .describe("Minimum years of experience (0 junior, 2 mid, 3+ senior)."),
  visaRequirements: z
    .array(z.enum(["Will Sponsor", "Not Required", "Required"]))
    .optional(),
  platforms: z
    .array(z.enum(PLATFORMS))
    .optional()
    .describe("Job source platforms."),
  companies: z.array(z.string().min(1).max(80)).max(10).optional(),
  postedWithinDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("Only jobs posted within this many days."),
});

type JobFilters = z.infer<typeof jobFiltersInput>;

const join = (values?: string[]) =>
  values && values.length > 0 ? values.join("|") : undefined;

const definedOnly = <T extends Record<string, unknown>>(params: T) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  ) as Partial<SearchJobsParams>;

function filtersToParams(filters: JobFilters = {}): Partial<SearchJobsParams> {
  return definedOnly({
    jobTitleKeywords: join(filters.keywords),
    location: join(filters.locations),
    jobType: join(filters.jobTypes),
    minSalary: filters.minSalary?.toString(),
    minExperience: filters.minExperience?.toString(),
    visaRequirement: join(filters.visaRequirements),
    platform: join(filters.platforms),
    companyName: join(filters.companies),
    createdAfterDays: filters.postedWithinDays?.toString(),
  });
}

/** Maps natural-language search filters to search params (no tab or relevance). */
function parsedFiltersToParams(
  filters: JobQueryFilters,
): Partial<SearchJobsParams> {
  return definedOnly({
    jobType: join(filters.jobType),
    jobTitleKeywords: join(filters.jobTitleKeywords),
    location: join(filters.location),
    platform: join(filters.platform),
    companyName: join(filters.companyName),
    minSalary: filters.minSalary?.toString(),
    minExperience: filters.minExperience?.toString(),
    createdAfterDays: filters.createdAfter,
    sortBy: filters.sortBy === "relevance" ? undefined : filters.sortBy,
    sortOrder: filters.sortOrder,
  });
}

function toJobList(result: SearchJobsResult) {
  if (!result.ok) {
    return result.status === 402
      ? INSUFFICIENT_CREDITS
      : { error: result.error };
  }
  return {
    jobs: result.data.map(compactJob),
    totalCount: result.totalCount,
    nextCursor: result.nextCursor,
  };
}

const limitOrDefault = (limit?: number) => limit ?? AGENT_LIST_DEFAULT_LIMIT;

/**
 * Logs a location-filtered search that found nothing (REQ-024), after the
 * response. Repeated misses for one name point to a missing location alias.
 */
function reportEmptyLocationSearch(
  ctx: AgentToolContext,
  toolName: string,
  locations: string[] | undefined,
  list: ReturnType<typeof toJobList>,
) {
  const jobs = "jobs" in list ? list.jobs : undefined;
  if (!locations?.length || !jobs || jobs.length > 0) return;
  after(() =>
    eventCaptureServer({
      event: PostHogEvent.AgentLocationNoResults,
      distinctId: ctx.user.id,
      properties: { tool: toolName, locations },
    }),
  );
}

export function createJobTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  return {
    searchJobs: tool({
      description:
        "Search GetHired's job listings with structured filters. Free. Returns compact jobs with ids; use nextCursor to page.",
      inputSchema: jobFiltersInput.extend({
        cursor: z
          .string()
          .optional()
          .describe("nextCursor from a previous searchJobs call."),
        limit: limitInput,
      }),
      execute: ({ cursor, limit, ...filters }) =>
        withToolErrors(ctx, "searchJobs", async () => {
          const list = toJobList(
            await searchJobs(supabase, {
              ...filtersToParams(filters),
              ...(cursor ? { cursor } : {}),
              limit: limitOrDefault(limit),
            }),
          );
          reportEmptyLocationSearch(ctx, "searchJobs", filters.locations, list);
          return list;
        }),
    }),

    naturalLanguageJobSearch: tool({
      description:
        "Turn a plain-English job request into filters with AI, then search. Costs 5 AI credits per call; prefer searchJobs when you can build the filters yourself.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(300)
          .describe("The user's request in their words."),
        limit: limitInput,
      }),
      execute: ({ query, limit }) =>
        withToolErrors(ctx, "naturalLanguageJobSearch", async () => {
          const validation = validateAndSanitizeSearchQuery(query, 300);
          if (!validation.success) return { error: validation.error! };

          const parsed = await parseJobQuery(
            supabase,
            ctx.user.id,
            validation.data!,
          );
          if (!parsed.ok) {
            return parsed.status === 402
              ? INSUFFICIENT_CREDITS
              : { error: parsed.error };
          }

          const list = toJobList(
            await searchJobs(supabase, {
              ...parsedFiltersToParams(parsed.filters),
              limit: limitOrDefault(limit),
            }),
          );
          reportEmptyLocationSearch(
            ctx,
            "naturalLanguageJobSearch",
            parsed.filters.location,
            list,
          );
          return "jobs" in list ? { ...list, filters: parsed.filters } : list;
        }),
    }),

    findRelevantJobs: tool({
      description:
        "Find jobs matched to the user's profile and primary resume, best matches first. Needs at least 5 AI credits but does not spend them.",
      inputSchema: z.object({
        filters: jobFiltersInput
          .optional()
          .describe("Optional filters to narrow the matches."),
        limit: limitInput,
      }),
      execute: ({ filters, limit }) =>
        withToolErrors(ctx, "findRelevantJobs", async () => {
          const { data: profile, error } = await supabase
            .from("user_info")
            .select("embedding_new")
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;

          if (!profile?.embedding_new) {
            return {
              error: "PROFILE_INCOMPLETE",
              message:
                "Personalised matches need a completed profile or a parsed primary resume. Ask the user to finish onboarding at /get-started or upload a resume.",
            };
          }

          const list = toJobList(
            await searchJobs(supabase, {
              ...filtersToParams(filters),
              sortBy: "relevance",
              limit: limitOrDefault(limit),
            }),
          );
          reportEmptyLocationSearch(ctx, "findRelevantJobs", filters?.locations, list);
          return list;
        }),
    }),

    findSimilarJobs: tool({
      description:
        "Find jobs similar to a given job. May spend 5 AI credits to re-rank results with AI when the user has enough credits.",
      inputSchema: z.object({ jobId: uuidInput("job"), limit: limitInput }),
      execute: ({ jobId, limit }) =>
        withToolErrors(ctx, "findSimilarJobs", async () =>
          toJobList(
            await searchJobs(supabase, {
              sortBy: "relevance",
              jobId,
              limit: limitOrDefault(limit),
            }),
          ),
        ),
    }),

    getJobDetails: tool({
      description:
        "Get full details of one job: description, experience, visa, salary and links, including applyUrl for applying on GetHired.",
      inputSchema: z.object({ jobId: uuidInput("job") }),
      execute: ({ jobId }) =>
        withToolErrors(ctx, "getJobDetails", async () => {
          const { data: job, error } = await supabase
            .from("all_jobs")
            .select(
              "id, job_name, company_name, locations, salary_range, job_type, experience, visa_requirement, platform, description, ai_summary, is_platform_job, created_at",
            )
            .eq("id", jobId)
            .maybeSingle();
          if (error) throw error;
          if (!job) return { error: "Job not found." };

          const description = job.description ?? "";
          return {
            ...compactJob(job),
            description:
              description.length > AGENT_JOB_DESCRIPTION_MAX_CHARS
                ? `${description.slice(0, AGENT_JOB_DESCRIPTION_MAX_CHARS)}…`
                : description,
            experience: job.experience,
            visaRequirement: job.visa_requirement,
            platform: job.platform,
            // companyUrl: job.company_url,
            summary: job.ai_summary,
            isPlatformJob: job.is_platform_job,
            // externalUrl: job.job_url,
            applyUrl: `/jobs/${job.id}${job.is_platform_job ? `?apply=true` : ""}`,
          };
        }),
    }),

    saveJob: tool({
      description: "Save (bookmark) a job for the user.",
      inputSchema: z.object({ jobId: uuidInput("job") }),
      execute: ({ jobId }) =>
        withToolErrors(ctx, "saveJob", async () => {
          const { data: existing, error: lookupError } = await supabase
            .from("user_favorites")
            .select("id")
            .eq("user_id", ctx.user.id)
            .eq("job_id", jobId)
            .maybeSingle();
          if (lookupError) throw lookupError;

          if (!existing) {
            const { error } = await supabase
              .from("user_favorites")
              .insert({ user_id: ctx.user.id, job_id: jobId });
            if (error?.code === "23503") return { error: "Job not found." };
            if (error) throw error;
          }

          return { jobId, saved: true };
        }),
    }),

    unsaveJob: tool({
      description: "Remove a job from the user's saved jobs.",
      inputSchema: z.object({ jobId: uuidInput("job") }),
      execute: ({ jobId }) =>
        withToolErrors(ctx, "unsaveJob", async () => {
          const { error } = await supabase
            .from("user_favorites")
            .delete()
            .eq("user_id", ctx.user.id)
            .eq("job_id", jobId);
          if (error) throw error;

          return { jobId, saved: false };
        }),
    }),

    listSavedJobs: tool({
      description: "List the jobs the user has saved.",
      inputSchema: z.object({ limit: limitInput }),
      execute: ({ limit }) =>
        withToolErrors(ctx, "listSavedJobs", async () =>
          toJobList(
            await searchJobs(supabase, {
              tab: "saved",
              limit: limitOrDefault(limit),
            }),
          ),
        ),
    }),
  };
}
