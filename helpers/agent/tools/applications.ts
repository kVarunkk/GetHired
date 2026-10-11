import { tool } from "ai";
import { z } from "zod";
import { TApplicationStatus } from "@/utils/types";
import { AGENT_LIST_DEFAULT_LIMIT } from "../config";
import { AgentToolContext, limitInput, uuidInput, withToolErrors } from "./shared";

const statusInput = z.nativeEnum(TApplicationStatus);

export function createApplicationTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  return {
    listApplications: tool({
      description:
        "List the user's job applications with their status, newest first. isPlatformJob tells whether the job was applied to through GetHired.",
      inputSchema: z.object({
        status: statusInput.optional().describe("Only applications with this status."),
        limit: limitInput,
      }),
      execute: ({ status, limit }) =>
        withToolErrors(ctx, "listApplications", async () => {
          let query = supabase
            .from("applications")
            .select(
              "id, status, created_at, updated_at, all_jobs ( id, job_name, company_name, locations, is_platform_job )",
            )
            .eq("applicant_user_id", ctx.user.id);
          if (status) query = query.eq("status", status);

          const { data, error } = await query
            .order("created_at", { ascending: false })
            .limit(limit ?? AGENT_LIST_DEFAULT_LIMIT);
          if (error) throw error;

          return {
            applications: (data ?? []).map((application) => {
              const job = application.all_jobs;
              return {
                id: application.id,
                jobId: job?.id ?? null,
                title: job?.job_name ?? null,
                company: job?.company_name ?? null,
                locations: job?.locations ?? [],
                status: application.status,
                appliedAt: application.created_at,
                updatedAt: application.updated_at,
                isPlatformJob: job?.is_platform_job ?? false,
                url: job ? `/jobs/${job.id}` : null,
              };
            }),
          };
        }),
    }),

    updateApplicationStatus: tool({
      description:
        "Track the status of the user's application to an external (non-GetHired) job, e.g. after they applied on the company site or heard back. Creates the application record if needed. Not allowed for jobs applied to through GetHired, whose status is set by the company.",
      inputSchema: z.object({ jobId: uuidInput("job"), status: statusInput }),
      execute: ({ jobId, status }) =>
        withToolErrors(ctx, "updateApplicationStatus", async () => {
          const { data: job, error: jobError } = await supabase
            .from("all_jobs")
            .select("id, is_platform_job, job_name, company_name")
            .eq("id", jobId)
            .maybeSingle();
          if (jobError) throw jobError;
          if (!job) return { error: "Job not found." };

          if (job.is_platform_job) {
            return {
              error:
                "This job was applied to through GetHired, so its status is set by the company and can't be changed here.",
            };
          }

          const { data: updated, error: updateError } = await supabase
            .from("applications")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("all_jobs_id", jobId)
            .eq("applicant_user_id", ctx.user.id)
            .select("id");
          if (updateError) throw updateError;

          const created = !updated || updated.length === 0;
          if (created) {
            const { error: insertError } = await supabase.from("applications").insert({
              applicant_user_id: ctx.user.id,
              all_jobs_id: jobId,
              status,
            });
            if (insertError) throw insertError;
          }

          return {
            jobId,
            title: job.job_name,
            company: job.company_name,
            status,
            created,
          };
        }),
    }),
  };
}
