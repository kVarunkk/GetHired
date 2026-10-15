import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { scrubPII } from "@/helpers/ai/fairness";
import { updateApplicationStatus } from "@/helpers/applications/update-application-status";
import { SCREENING_VIEW_COLUMNS, toScreeningView } from "@/helpers/matching/screening-view";
import type { TResumeRowContent } from "@/utils/types";
import { Constants } from "@/utils/types/database.types";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
import { RA_MAX_BULK_APPLICATIONS } from "../config";
import {
  AGENT_CANDIDATE_COLUMNS,
  applicationUrl,
  type CandidateRow,
  compactCandidate,
  limitInput,
  type RecruiterToolContext,
  resumeExcerpt,
  uuidInput,
  withToolErrors,
} from "./shared";

const NOT_FOUND = { error: "Application not found." } as const;
const JOB_NOT_FOUND = { error: "Job post not found." } as const;

const APPLICATION_STATUSES = Constants.public.Enums.application_status;
const RECOMMENDATIONS = ["strong_yes", "yes", "maybe", "no"] as const;

/** Rows read when filtering or sorting by fit, which happens after the query. */
const FIT_SCAN_LIMIT = 200;

type ScreeningSummary = { status: string; fit_score: number | null; recommendation: string | null } | null;


export function createApplicantTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    listApplicants: tool({
      description:
        "List applications to the company's jobs: who applied, to which job, their status, and their AI screening fit score (0–100) and recommendation when screened. Filter by job, status, minimum fit score or recommendation; sort by most recent or best fit.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post").optional(),
        status: z.enum(APPLICATION_STATUSES).optional(),
        minFitScore: z.number().int().min(0).max(100).optional(),
        recommendation: z.enum(RECOMMENDATIONS).optional(),
        sort: z.enum(["recent", "fit"]).optional().describe("Default: recent."),
        limit: limitInput,
      }),
      execute: ({ jobPostId, status, minFitScore, recommendation, sort, limit }) =>
        withToolErrors(ctx, "listApplicants", async () => {
          const byFit = sort === "fit" || minFitScore !== undefined || recommendation !== undefined;
          const max = limit ?? AGENT_LIST_DEFAULT_LIMIT;

          let query = supabase
            .from("applications")
            .select(
              `id, status, created_at, applicant_user_id, job_postings!inner(id, title, company_id), user_info(${AGENT_CANDIDATE_COLUMNS}), application_screenings(status, fit_score, recommendation)`,
            )
            .eq("job_postings.company_id", company.id);
          if (jobPostId) query = query.eq("job_post_id", jobPostId);
          if (status) query = query.eq("status", status);
          const { data, error } = await query
            .order("created_at", { ascending: false })
            .limit(byFit ? FIT_SCAN_LIMIT : max);
          if (error) throw error;

          let rows = (data ?? []).map((row) => {
            const screening = row.application_screenings as ScreeningSummary;
            const completed = screening?.status === "completed" ? screening : null;
            const candidate = row.user_info as CandidateRow | null;
            return {
              applicationId: row.id,
              candidateId: row.applicant_user_id,
              name: candidate?.full_name ?? null,
              roles: (candidate?.desired_roles ?? []).slice(0, 3),
              experienceYears: candidate?.experience_years ?? null,
              job: { id: row.job_postings.id, title: row.job_postings.title },
              status: row.status,
              appliedAt: row.created_at,
              screening: screening?.status ?? "not_screened",
              fitScore: completed?.fit_score ?? null,
              recommendation: completed?.recommendation ?? null,
              url: applicationUrl(row.id),
            };
          });

          if (minFitScore !== undefined) {
            rows = rows.filter((r) => r.fitScore !== null && r.fitScore >= minFitScore);
          }
          if (recommendation) rows = rows.filter((r) => r.recommendation === recommendation);
          if (sort === "fit") rows.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));

          return { applicants: rows.slice(0, max) };
        }),
    }),

    getApplication: tool({
      description:
        "Read one application to the company's jobs: the candidate's profile, their answers to the job's questions, a resume excerpt, and the AI screening. Contact details aren't available here; the application page has them.",
      inputSchema: z.object({ applicationId: uuidInput("application") }),
      execute: ({ applicationId }) =>
        withToolErrors(ctx, "getApplication", async () => {
          const { data: application, error } = await supabase
            .from("applications")
            .select(
              `id, status, created_at, answers, resume_id, applicant_user_id, job_postings!inner(id, title, company_id, questions), user_info(${AGENT_CANDIDATE_COLUMNS})`,
            )
            .eq("id", applicationId)
            .eq("job_postings.company_id", company.id)
            .maybeSingle();
          if (error) throw error;
          if (!application) return NOT_FOUND;

          const resumes = supabase.from("resumes").select("content");
          const [{ data: resume }, { data: screeningRow }] = await Promise.all([
            (application.resume_id
              ? resumes.eq("id", application.resume_id)
              : resumes.eq("user_id", application.applicant_user_id ?? "").eq("is_primary", true)
            )
              .limit(1)
              .maybeSingle(),
            supabase
              .from("application_screenings")
              .select(SCREENING_VIEW_COLUMNS)
              .eq("application_id", application.id)
              .maybeSingle(),
          ]);

          const questions = application.job_postings.questions ?? [];
          const answers = questions.length
            ? wrapInSandbox(
                "application_answers",
                questions
                  .map((question, i) => {
                    const answer = application.answers?.[i]?.trim();
                    return `Q${i + 1}: ${question}\nA${i + 1}: ${answer ? scrubPII(answer) : "[no answer]"}`;
                  })
                  .join("\n\n"),
              )
            : null;

          const screening = screeningRow ? toScreeningView(screeningRow) : null;
          const candidate = application.user_info as CandidateRow | null;

          return {
            applicationId: application.id,
            status: application.status,
            appliedAt: application.created_at,
            job: { id: application.job_postings.id, title: application.job_postings.title },
            candidate: candidate ? compactCandidate(candidate) : null,
            answers,
            resumeExcerpt: resumeExcerpt(resume?.content as TResumeRowContent | null),
            screening: screening
              ? {
                  status: screening.status,
                  fitScore: screening.fit_score,
                  recommendation: screening.recommendation,
                  // Derived from candidate text, so sandboxed (RA-SEC-003).
                  details:
                    screening.status === "completed" && screening.result
                      ? wrapInSandbox("screening", JSON.stringify(screening.result))
                      : null,
                }
              : null,
            url: applicationUrl(application.id),
          };
        }),
    }),

    updateApplicationStatus: tool({
      description: `Change the status of up to ${RA_MAX_BULK_APPLICATIONS} applications to the company's jobs. With notify, each applicant gets the standard status email.`,
      inputSchema: z.object({
        applicationIds: z.array(uuidInput("application")).min(1).max(RA_MAX_BULK_APPLICATIONS),
        status: z.enum(APPLICATION_STATUSES),
        notify: z.boolean().describe("Email each applicant about the change."),
      }),
      execute: ({ applicationIds, status, notify }) =>
        withToolErrors(ctx, "updateApplicationStatus", async () => {
          const updated: string[] = [];
          const failed: { applicationId: string; error: string }[] = [];
          for (const applicationId of new Set(applicationIds)) {
            const result = await updateApplicationStatus(ctx, { applicationId, status, notify });
            if (result.ok) updated.push(applicationId);
            else failed.push({ applicationId, error: result.error });
          }
          return { status, updated, failed, emailed: notify };
        }),
    }),

    getHiringFunnel: tool({
      description:
        "Count applications by status, for one of the company's jobs or across all of them.",
      inputSchema: z.object({ jobPostId: uuidInput("job post").optional() }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getHiringFunnel", async () => {
          if (jobPostId) {
            const { data: job, error } = await supabase
              .from("job_postings")
              .select("id")
              .eq("id", jobPostId)
              .eq("company_id", company.id)
              .maybeSingle();
            if (error) throw error;
            if (!job) return JOB_NOT_FOUND;
          }

          let query = supabase
            .from("applications")
            .select("status, job_postings!inner(company_id)")
            .eq("job_postings.company_id", company.id);
          if (jobPostId) query = query.eq("job_post_id", jobPostId);
          const { data, error } = await query;
          if (error) throw error;

          const byStatus: Record<string, number> = {};
          for (const { status } of data ?? []) byStatus[status] = (byStatus[status] ?? 0) + 1;
          return { ...(jobPostId ? { jobPostId } : {}), total: (data ?? []).length, byStatus };
        }),
    }),
  };
}
