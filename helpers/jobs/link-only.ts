import type { Database } from "@/utils/types/database.types";

export type JobVisibility = Database["public"]["Enums"]["job_post_visibility"];

/**
 * JL-REQ-026: link-only jobs can be created only once the applicant code that
 * filters `all_jobs.listed` is live. `JOB_LINK_ONLY_ENABLED=true` turns the
 * form field and the agent's `visibility` on (server-side only).
 */
export function linkOnlyEnabled(value: string | undefined = process.env.JOB_LINK_ONLY_ENABLED): boolean {
  return value === "true";
}

export const LINK_ONLY_DISABLED = "Link-only jobs aren't available yet.";

export const VISIBILITY_OPTIONS: { value: JobVisibility; label: string }[] = [
  { value: "public", label: "Anyone (job board, search, careers page and job sites)" },
  { value: "link_only", label: "Only people with the link" },
];
