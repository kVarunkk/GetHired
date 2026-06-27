import { z } from "zod";

const JOB_TYPES = ["Fulltime", "Contract", "Intern"] as const;
// const VISA_REQUIREMENTS = [
//   "US Citizenship/Visa Not Required",
//   "US Citizen/Visa Only",
//   "Will Sponsor",
// ] as const;
const APPLICATION_STATUSES = [
  "submitted",
  "reviewed",
  "selected",
  "stand_by",
  "rejected",
] as const;
const PLATFORMS = [
  "ycombinator",
  "wellfound",
  "lightspeed",
  "a16z",
  "khosla",
  "susa",
  "sapphire",
  "accel",
  "sierra",
  "workingnomads",
  "jobleads",
  "naukri",
  "glassdoor",
  "greenhouse",
  "weworkremotely",
  "remoteok",
  "uplers",
  "gethired",
] as const;

const preprocessArray = (schema: z.ZodArray<any>) =>
  z.preprocess((val) => {
    if (typeof val === "string") return val.split("|").filter(Boolean);
    if (Array.isArray(val)) return val;
  }, schema);

export const jobFilterSchema = z.object({
  jobType: preprocessArray(z.array(z.enum(JOB_TYPES)))
    .optional()
    .describe(
      "List of job types (allowed values: 'Fulltime', 'Contract', 'Intern').",
    ),

  jobTitleKeywords: preprocessArray(z.array(z.string()))
    .optional()
    .describe(
      "List of keywords for the job title. Examples: for 'frontend', include ['front end', 'front-end', 'frontend']; for 'backend', include ['back end', 'back-end', 'backend']; for 'SDE', include ['software engineer', 'SDE', 'software developer'].",
    ),

  location: preprocessArray(z.array(z.string()))
    .optional()
    .describe(
      "List of general locations (e.g., 'Bangalore' (change 'bengaluru' to 'bangalore'), 'Gurgaon' (change 'gurugram' to 'gurgaon'), 'Remote').",
    ),

  // visaRequirement: preprocessArray(z.array(z.enum(VISA_REQUIREMENTS)))
  //   .optional()
  //   .describe("List of visa requirement terms."),

  platform: preprocessArray(z.array(z.enum(PLATFORMS)))
    .optional()
    .describe("List of job source platforms."),

  companyName: preprocessArray(z.array(z.string()))
    .optional()
    .describe("List of company names to filter by."),

  applicationStatus: preprocessArray(z.array(z.enum(APPLICATION_STATUSES)))
    .optional()
    .describe("List of application status terms."),

  minSalary: z.coerce
    .number()
    .min(0)
    .optional()
    .describe("Minimum salary in simplest integer form."),

  minExperience: z.coerce
    .number()
    .min(0)
    .optional()
    .describe(
      "Minimum years of experience required. Add 3 for a Senior postition. 2 for Mid level. 0 for Junior/Fresher position.",
    ),

  createdAfter: z
    .enum(["1", "3", "7", "14"])
    .optional()
    .describe(
      "Filter jobs posted within the specified time frame (eg., Last week means '7', Last 24 hours means '1' and so on. If user specifies a number not present in the enum available then choose the closest option available).",
    ),

  sortBy: z
    .enum(["created_at", "company_name", "salary_min", "relevance"])
    .optional()
    .describe("List of fields to sort by. Do not use 'relevance'."),

  sortOrder: z.enum(["asc", "desc"]).optional().describe("Sorting direction."),

  tab: z
    .enum(["saved", "applied", "all"])
    .optional()
    .describe("Tab to filter by."),

  jobId: z.string().optional().describe("Job ID for similar job search."),
});

export type TJobFilters = z.infer<typeof jobFilterSchema>;

export const serializeFiltersToURL = (
  filters: Partial<TJobFilters>,
): string => {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join("|"));
    } else if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });

  return params.toString();
};
