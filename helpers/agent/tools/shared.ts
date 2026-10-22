import { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { Database } from "@/utils/types/database.types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { AGENT_LIST_DEFAULT_LIMIT, AGENT_LIST_MAX_LIMIT } from "../config";

/**
 * Server-side context every tool closes over. The acting user always comes
 * from here, never from model input (SEC-002).
 */
export type AgentToolContext = {
  supabase: SupabaseClient<Database>;
  user: User;
  sessionId: string;
};

export type ToolError = { error: string; [key: string]: unknown };

export const INSUFFICIENT_CREDITS = {
  error: "INSUFFICIENT_CREDITS",
  message: "Not enough AI credits for this action.",
  rechargeUrl: "/dashboard/buy-credits",
} as const;

export const limitInput = z
  .number()
  .int()
  .min(1)
  .max(AGENT_LIST_MAX_LIMIT)
  .optional()
  .describe(`How many results to return (default ${AGENT_LIST_DEFAULT_LIMIT}).`);

export const uuidInput = (what: string) =>
  z.string().uuid().describe(`The ${what} id, exactly as returned by another tool.`);

type JobLike = {
  id: string;
  job_name?: string | null;
  company_name?: string | null;
  locations?: string[] | null;
  salary_range?: string | null;
  job_type?: string | null;
  experience?: string | null;
  created_at?: string | null;
};

/** The job fields the model needs (GUD-001). */
export function compactJob(job: JobLike) {
  return {
    id: job.id,
    title: job.job_name ?? null,
    company: job.company_name ?? null,
    locations: job.locations ?? [],
    salary: job.salary_range ?? null,
    jobType: job.job_type ?? null,
    experience: job.experience ?? null,
    postedAt: job.created_at ?? null,
    url: `/jobs/${job.id}`,
  };
}

/**
 * Runs a tool body so it never throws: unexpected errors are reported to
 * PostHog and replaced with a generic message, so raw database or provider
 * errors never reach the model or the client (SEC-006).
 */
export async function withToolErrors<T>(
  ctx: AgentToolContext,
  toolName: string,
  run: () => Promise<T>,
): Promise<T | ToolError> {
  try {
    return await run();
  } catch (error) {
    await eventCaptureServerException({
      error,
      distinctId: ctx.user.id,
      properties: { flow: "agent_tool", tool: toolName, session_id: ctx.sessionId },
    });
    return {
      error: `Something went wrong while running ${toolName}. Please try again.`,
    };
  }
}
