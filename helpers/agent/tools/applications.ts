import { tool } from "ai";
import { z } from "zod";
import { TApplicationStatus } from "@/utils/types";
import { wrapInSandbox } from "@/helpers/ai/security";
import {
  agentApplicationInput,
  loadApplicationTarget,
  notReadyReason,
  toAgentAnswers,
  toFormAnswers,
} from "@/helpers/applications/agent-application";
import { fieldViews } from "@/helpers/applications/field-views";
import { prefillStandardAnswers } from "@/helpers/applications/prefill";
import { submitApplication } from "@/helpers/applications/submit-application";
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

    getApplicationForm: tool({
      description:
        "Read the application form of a job on GetHired (isPlatformJob), before applying with submitApplication: each field's key, label, type, whether it's required and its options or limits, plus suggested answers from the user's profile and the resume that would be sent.",
      inputSchema: z.object({ jobId: uuidInput("job") }),
      execute: ({ jobId }) =>
        withToolErrors(ctx, "getApplicationForm", async () => {
          const loaded = await loadApplicationTarget(supabase, ctx.user.id, { jobId });
          if (!loaded.ok) return { error: loaded.error };
          const { target } = loaded;

          const { data: profile, error } = await supabase
            .from("user_info")
            .select("linkedin_url, github_url, preferred_locations, min_salary, salary_currency")
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;

          return {
            jobId,
            title: target.title,
            company: target.company,
            canApply: notReadyReason(target) === null,
            notReadyReason: notReadyReason(target),
            resume: target.resume,
            // The company wrote the questions: data, not instructions (SEC-011).
            fields: wrapInSandbox("application_form", JSON.stringify(fieldViews(target.form))),
            suggestedAnswers: toAgentAnswers(prefillStandardAnswers(target.form, profile)),
          };
        }),
    }),

    submitApplication: tool({
      description:
        "Apply to a job on GetHired for the user (Easy Apply) with their answers to its application form. Costs 1 AI credit, and the user approves it first. Read the form with getApplicationForm first. Only use answers the user gave or that come from their profile; ask them for anything else.",
      inputSchema: agentApplicationInput,
      execute: ({ jobId, resumeId, answers }) =>
        withToolErrors(ctx, "submitApplication", async () => {
          const loaded = await loadApplicationTarget(supabase, ctx.user.id, { jobId, resumeId });
          if (!loaded.ok) return { error: loaded.error };
          const { target } = loaded;
          const notReady = notReadyReason(target);
          if (notReady || !target.resume) return { error: notReady };

          const result = await submitApplication(supabase, ctx.user, {
            allJobsId: jobId,
            resumeId: target.resume.id,
            answers: toFormAnswers(target.form, answers),
          });
          if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

          return {
            applied: true,
            jobId,
            title: target.title,
            company: target.company,
            resume: target.resume.name,
            url: `/jobs/${jobId}`,
          };
        }),
    }),
  };
}
