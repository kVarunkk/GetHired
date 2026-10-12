import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { tool } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { getProfile } from "@/helpers/user/get-profile";
import { TablesUpdate } from "@/utils/types/database.types";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { AgentToolContext, withToolErrors } from "./shared";

export const SALARY_CURRENCIES = ["₹", "$", "€", "£", "C$", "A$"] as const;

const keywordList = (max: number) => z.array(z.string().min(1).max(60)).min(1).max(max);

const preferencesInput = z
  .object({
    desiredRoles: keywordList(10).optional(),
    preferredLocations: keywordList(10).optional(),
    minSalary: z.number().int().min(0).optional(),
    maxSalary: z.number().int().min(0).optional(),
    salaryCurrency: z.enum(SALARY_CURRENCIES).optional(),
    jobTypes: z.array(z.enum(["Fulltime", "Contract", "Intern"])).min(1).optional(),
    visaSponsorshipRequired: z.boolean().optional(),
    topSkills: keywordList(30).optional(),
    workStylePreferences: keywordList(10)
      .optional()
      .describe("e.g. Remote, Hybrid, On-site, Startup Environment, Fast-paced."),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one preference to update.",
  })
  .refine(
    (input) =>
      input.minSalary === undefined ||
      input.maxSalary === undefined ||
      input.minSalary <= input.maxSalary,
    { message: "minSalary must not exceed maxSalary." },
  );

type Preferences = z.infer<typeof preferencesInput>;

const COLUMNS = {
  desiredRoles: "desired_roles",
  preferredLocations: "preferred_locations",
  minSalary: "min_salary",
  maxSalary: "max_salary",
  salaryCurrency: "salary_currency",
  jobTypes: "job_type",
  visaSponsorshipRequired: "visa_sponsorship_required",
  topSkills: "top_skills",
  workStylePreferences: "work_style_preferences",
} as const satisfies Record<keyof Preferences, string>;

export function createProfileTools(ctx: AgentToolContext) {
  return {
    getMyProfile: tool({
      description:
        "Get the user's name, AI credit balance, onboarding status, weekly activity and three most recent applications.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "getMyProfile", () => getProfile(ctx.supabase, ctx.user)),
    }),

    updateMyPreferences: tool({
      description:
        "Update the user's job preferences on their profile (roles, locations, salary, job types, visa, skills, work style). Personalised matches are refreshed afterwards. The user must approve. Send only the fields that change.",
      inputSchema: preferencesInput,
      execute: (preferences) =>
        withToolErrors(ctx, "updateMyPreferences", async () => {
          // Save canonical names ("Bangalore" -> "Bengaluru"), as the location picker does.
          const preferredLocations = preferences.preferredLocations
            ? await canonicalizeLocations(preferences.preferredLocations)
            : undefined;
          if (preferredLocations) preferences = { ...preferences, preferredLocations };

          const fields = Object.keys(preferences) as (keyof Preferences)[];
          const update = Object.fromEntries(
            fields.map((field) => [COLUMNS[field], preferences[field]]),
          ) as TablesUpdate<"user_info">;

          const { data, error } = await ctx.supabase
            .from("user_info")
            .update(update)
            .eq("user_id", ctx.user.id)
            .select("user_id");
          if (error) throw error;
          if (!data || data.length === 0) {
            return {
              error: "Profile not found. Ask the user to complete onboarding at /get-started.",
            };
          }

          after(() => updateUserEmbedding(ctx.user.id));

          return preferredLocations
            ? { updated: fields, preferredLocations }
            : { updated: fields };
        }),
    }),
  };
}
