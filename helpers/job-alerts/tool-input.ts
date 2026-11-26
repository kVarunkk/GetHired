/**
 * The job alert tools' inputs (JA-REQ-060), shared by the agent and MCP tools
 * and the confirmation preview. Client-safe.
 */
import { z } from "zod";
import { currencyCodeSchema } from "@/helpers/currency/currencies";
import { platformsArray } from "@/utils/platforms";
import { type AlertFilters, alertFiltersFromSearchParams, JOB_ALERT_FREQUENCIES } from "./filters";

const PLATFORMS = platformsArray.map((platform) => platform.value) as [string, ...string[]];

const textList = (maxLength: number) => z.array(z.string().min(1).max(maxLength)).max(10).optional();
const years = z.number().int().min(0).max(30).optional();

/** The searchJobs filters an alert can keep. Strict, so one it can't keep is refused, not dropped. */
export const alertToolFiltersSchema = z
  .object({
    keywords: textList(50).describe(
      "Job title keywords, including common variants, e.g. ['frontend', 'front-end', 'front end']. No seniority words.",
    ),
    locations: textList(60).describe("Locations, e.g. ['Remote', 'Bengaluru']."),
    jobTypes: z.array(z.enum(["Fulltime", "Contract", "Intern"])).optional(),
    minSalary: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum yearly salary as a plain integer, in salaryCurrency (20 LPA = 2000000)."),
    salaryCurrency: currencyCodeSchema
      .optional()
      .describe("ISO 4217 code of minSalary. Defaults to the user's profile currency; ignored without minSalary."),
    minExperience: years.describe("Only jobs whose experience range reaches at least this many years."),
    maxExperience: years.describe("Only jobs asking for at most this many years."),
    platforms: z.array(z.enum(PLATFORMS)).optional().describe("Job source platforms."),
    companies: textList(80),
  })
  .strict();

export type AlertToolFilters = z.infer<typeof alertToolFiltersSchema>;

export const createJobAlertInput = z.object({
  filters: alertToolFiltersSchema.describe("The search to be alerted about. At least one filter."),
  frequency: z.enum(JOB_ALERT_FREQUENCIES).describe("How often new jobs are emailed. Weekly emails go out on Mondays."),
});

export const updateJobAlertInput = z.object({
  alertId: z.string().uuid().describe("The alert id, exactly as returned by another tool."),
  on: z.boolean().optional().describe("false pauses the alert, true resumes it."),
  frequency: z.enum(JOB_ALERT_FREQUENCIES).optional(),
});

/** Read the way a /jobs URL is, so every alert is cleaned the same way. */
export function alertFiltersFromTool(filters: AlertToolFilters): AlertFilters | null {
  const join = (values?: string[]) => (values?.length ? values.join("|") : undefined);
  return alertFiltersFromSearchParams({
    jobTitleKeywords: join(filters.keywords),
    location: join(filters.locations),
    jobType: join(filters.jobTypes),
    platform: join(filters.platforms),
    companyName: join(filters.companies),
    minSalary: filters.minSalary?.toString(),
    // A currency only narrows a salary filter, as in searchJobs.
    salaryCurrency: filters.minSalary ? filters.salaryCurrency : undefined,
    minExperience: filters.minExperience?.toString(),
    maxExperience: filters.maxExperience?.toString(),
  });
}
