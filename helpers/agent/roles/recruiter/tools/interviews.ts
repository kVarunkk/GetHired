import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { getInterviewConfig, saveInterviewConfig } from "@/helpers/interview/screening/config";
import { getInterviewFunnel } from "@/helpers/interview/screening/funnel";
import { inviteApplicants, MAX_BULK_INVITES, type InviteSkipReason } from "@/helpers/interview/screening/invite";
import { getApplicationInterview } from "@/helpers/interview/screening/application-interview";
import { inviteSkipMessage } from "@/helpers/interview/screening/copy";
import {
  INTERVIEW_DURATIONS,
  INVITE_RULES,
  MAX_COMPETENCIES,
  MAX_COMPETENCY_DESCRIPTION_CHARS,
  MAX_COMPETENCY_NAME_CHARS,
  MAX_DEADLINE_DAYS,
  MAX_INTERVIEW_QUESTIONS,
  MAX_QUESTION_CHARS,
  MIN_DEADLINE_DAYS,
} from "@/helpers/interview/screening/schemas";
import { applicationUrl, jobPostUrl, requireToolPermission, type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

const JOB_NOT_FOUND = { error: "Job post not found." } as const;
const NO_INTERVIEW = { error: "This application has no AI interview." } as const;

/** The job, when it's the session company's. */
async function companyJob(ctx: RecruiterToolContext, jobPostId: string) {
  const { data, error } = await ctx.supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", jobPostId)
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the job post: ${error.message}`);
  return data;
}

/**
 * Tools from the screening interview spec (§3.5, RA phase 6). The transcript
 * never reaches the agent: reports carry verbatim quotes, sandboxed as
 * candidate text (SI-SEC-005, RA-SEC-003).
 */
export function createInterviewTools(ctx: RecruiterToolContext) {
  return {
    getInterviewSetup: tool({
      description:
        "Get a job's AI screening interview setup (on or off, who gets invited, competencies, must-ask questions, length, deadline) and its funnel: how many were invited, are waiting, in progress, completed, expired or declined, and the average overall score (1–5).",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getInterviewSetup", async () => {
          const job = await companyJob(ctx, jobPostId);
          if (!job) return JOB_NOT_FOUND;
          const [config, funnel] = await Promise.all([
            getInterviewConfig(ctx.supabase, jobPostId),
            getInterviewFunnel(ctx.supabase, jobPostId),
          ]);
          return {
            jobPostId,
            jobTitle: job.title,
            config,
            funnel,
            ...(config ? {} : { message: "This job has no AI interview yet. configureScreeningInterview sets one up." }),
            url: jobPostUrl(jobPostId),
          };
        }),
    }),

    configureScreeningInterview: tool({
      description:
        "Set up or change a job's AI screening interview: a short voice interview on the competencies you choose (1–5, each with a job-related description), up to 8 must-ask questions, 10/15/20 minutes, a 3–14 day deadline. inviteRule 'fit_threshold' invites applicants whose AI screening fit score reaches fitThreshold (each new applicant is screened automatically); 'manual' only invites people the user picks. Competencies and questions must be job-related: nothing about age, gender, nationality, accent, native language, family or other protected characteristics. Invites already sent keep their old setup. Draft the setup from the job post with getJobPost first when the user doesn't give one.",
      inputSchema: z
        .object({
          jobPostId: uuidInput("job post"),
          enabled: z.boolean().describe("Whether new invites can go out."),
          inviteRule: z.enum(INVITE_RULES),
          fitThreshold: z.number().int().min(0).max(100).optional().describe("The minimum fit score (0–100) for fit_threshold. Default 70."),
          questions: z.array(z.string().min(1).max(MAX_QUESTION_CHARS)).max(MAX_INTERVIEW_QUESTIONS),
          competencies: z
            .array(
              z
                .object({
                  name: z.string().min(1).max(MAX_COMPETENCY_NAME_CHARS),
                  description: z.string().max(MAX_COMPETENCY_DESCRIPTION_CHARS),
                })
                .strict(),
            )
            .min(1)
            .max(MAX_COMPETENCIES),
          durationMinutes: z.union(INTERVIEW_DURATIONS.map((d) => z.literal(d)) as [z.ZodLiteral<10>, z.ZodLiteral<15>, z.ZodLiteral<20>]),
          deadlineDays: z.number().int().min(MIN_DEADLINE_DAYS).max(MAX_DEADLINE_DAYS),
        })
        .strict(),
      execute: (input) =>
        withToolErrors(ctx, "configureScreeningInterview", async () => {
          // The same two keys as saveInterviewConfigAction.
          const denied = requireToolPermission(ctx, "jobs.edit", input.jobPostId);
          if (denied) return denied;
          const job = await companyJob(ctx, input.jobPostId);
          if (!job) return JOB_NOT_FOUND;

          const result = await saveInterviewConfig(
            ctx.supabase,
            { companyId: ctx.company.id, jobPostId: input.jobPostId },
            {
              enabled: input.enabled,
              invite_rule: input.inviteRule,
              ...(input.fitThreshold !== undefined ? { fit_threshold: input.fitThreshold } : {}),
              questions: input.questions.map((text) => ({ text })),
              competencies: input.competencies,
              duration_minutes: input.durationMinutes,
              deadline_days: input.deadlineDays,
              language: "en",
            },
          );
          if (!result.ok) return { error: result.error, ...(result.field ? { field: result.field } : {}) };
          return { jobPostId: input.jobPostId, saved: true, config: result.config, url: jobPostUrl(input.jobPostId) };
        }),
    }),

    inviteToInterview: tool({
      description: `Invite applicants to their job's AI screening interview (at most ${MAX_BULK_INVITES}). The job's interview must be on. Each invite holds the interview's length in interview minutes, charged only when the applicant completes it. The applicant gets an email with a link and a deadline. Returns who was invited and who was skipped, with the reason.`,
      inputSchema: z.object({
        applicationIds: z.array(uuidInput("application")).min(1).max(MAX_BULK_INVITES),
      }),
      execute: ({ applicationIds }) =>
        withToolErrors(ctx, "inviteToInterview", async () => {
          const ids = [...new Set(applicationIds)];
          // RLS: only applications on jobs the user can see.
          const { data: rows, error } = await ctx.supabase
            .from("applications")
            .select("id, job_post_id")
            .in("id", ids);
          if (error) throw new Error(`Failed to load the applications: ${error.message}`);

          const byJob = new Map<string, string[]>();
          for (const row of rows ?? []) {
            if (!row.job_post_id) continue;
            byJob.set(row.job_post_id, [...(byJob.get(row.job_post_id) ?? []), row.id]);
          }
          const found = new Set([...byJob.values()].flat());

          const invited: string[] = [];
          const skipped: { applicationId: string; reason: InviteSkipReason; message: string }[] = [];
          for (const [jobPostId, jobApplicationIds] of byJob) {
            const result = await inviteApplicants(ctx, { jobPostId, applicationIds: jobApplicationIds, via: "agent" });
            if (!result.ok) return { error: result.error };
            invited.push(...result.invited.map((i) => i.applicationId));
            skipped.push(
              ...result.skipped.map((s) => ({ applicationId: s.id, reason: s.reason, message: inviteSkipMessage(s.reason) })),
            );
          }
          for (const id of ids) {
            if (!found.has(id)) skipped.push({ applicationId: id, reason: "not_found", message: inviteSkipMessage("not_found") });
          }
          return { invited, skipped };
        }),
    }),

    getInterviewReport: tool({
      description:
        "Read one application's AI screening interview: its status, attempts, and the report: each competency's score (1–5, null when not assessed) with the rationale and verbatim quotes, must-ask question coverage, summary, strengths, concerns, follow-up questions for the human interview, and the overall score (mean of assessed competencies). The report is a screening signal, not a decision; there's no hire/no-hire recommendation. Never quote a score as if it settles the decision.",
      inputSchema: z.object({ applicationId: uuidInput("application") }),
      execute: ({ applicationId }) =>
        withToolErrors(ctx, "getInterviewReport", async () => {
          const interview = await getApplicationInterview(ctx.supabase, applicationId);
          if (!interview) return NO_INTERVIEW;
          const result = interview.report?.result ?? null;
          return {
            applicationId,
            status: interview.status,
            deadlineAt: interview.deadlineAt,
            attemptsUsed: interview.attemptsUsed,
            maxAttempts: interview.maxAttempts,
            attempts: interview.attempts.map((a) => ({ endReason: a.endReason, durationSeconds: a.durationSeconds })),
            overallScore: result?.overallScore ?? null,
            reportStatus: interview.report?.status ?? null,
            // Quotes and summaries come from the candidate's words (RA-SEC-003).
            report: result
              ? wrapInSandbox(
                  "interview_report",
                  JSON.stringify({
                    competencies: result.competencies,
                    questionCoverage: result.questionCoverage.map(({ question, asked }) => ({ question, asked })),
                    summary: result.summary,
                    strengths: result.strengths,
                    concerns: result.concerns,
                    followUpQuestions: result.followUpQuestions,
                  }),
                )
              : null,
            url: applicationUrl(applicationId),
          };
        }),
    }),

    compareInterviewReports: tool({
      description:
        "Compare 2–5 applications' AI screening interviews side by side: each competency's score (null when not assessed) and the overall score, per applicant. Scores only, no quotes; use getInterviewReport for the evidence.",
      inputSchema: z.object({
        applicationIds: z.array(uuidInput("application")).min(2).max(5),
      }),
      execute: ({ applicationIds }) =>
        withToolErrors(ctx, "compareInterviewReports", async () => {
          const ids = [...new Set(applicationIds)];
          const { data: apps, error } = await ctx.supabase
            .from("applications")
            .select("id, user_info(full_name)")
            .in("id", ids);
          if (error) throw new Error(`Failed to load the applications: ${error.message}`);
          const names = new Map((apps ?? []).map((a) => [a.id, a.user_info?.full_name?.trim() || "Applicant"]));

          const interviews = await Promise.all(ids.map((id) => getApplicationInterview(ctx.supabase, id)));
          const competencies = [
            ...new Set(interviews.flatMap((i) => i?.report?.result?.competencies.map((c) => c.name) ?? i?.competencies.map((c) => c.name) ?? [])),
          ];
          const rows = ids.map((id, i) => {
            const interview = interviews[i];
            const result = interview?.report?.result ?? null;
            return {
              applicationId: id,
              name: names.get(id) ?? "Applicant",
              status: interview?.status ?? "not_invited",
              overallScore: result?.overallScore ?? null,
              scores: Object.fromEntries(
                competencies.map((name) => [name, result?.competencies.find((c) => c.name === name)?.score ?? null]),
              ),
              url: applicationUrl(id),
            };
          });
          // Candidate names are candidate-written (RA-SEC-003).
          return { competencies, rows: wrapInSandbox("interview_comparison", JSON.stringify(rows)) };
        }),
    }),
  };
}
