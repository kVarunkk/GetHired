import { tool } from "ai";
import { answersView } from "@/helpers/applications/answers-view";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { scrubPII } from "@/helpers/ai/fairness";
import { readResumeSnapshot } from "@/helpers/applications/resume-snapshot";
import { SCREENING_VIEW_COLUMNS, toScreeningView } from "@/helpers/matching/screening-view";
import type { TResumeRowContent } from "@/utils/types";
import { Constants } from "@/utils/types/database.types";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
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

const APPLICATION_STATUSES = Constants.public.Enums.application_status;
const RECOMMENDATIONS = ["strong_yes", "yes", "maybe", "no"] as const;

/** Rows read when filtering or sorting by fit, which happens after the query. */
const FIT_SCAN_LIMIT = 200;

type ScreeningSummary = { status: string; fit_score: number | null; recommendation: string | null } | null;

/**
 * BI-REQ-030: an imported candidate (no account) is shown by name only, and
 * the name, typed or uploaded by the company, is sandboxed. Contact details
 * never reach the agent.
 */
const importedName = (fullName: string | null | undefined) =>
  wrapInSandbox("candidate_name", fullName?.trim() || "Candidate");


export function createApplicantTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    listApplicants: tool({
      description:
        "List applications to the company's jobs: who applied, to which job, their pipeline stage and status, and their AI screening fit score (0–100) and recommendation when screened. Filter by job, stage, status, minimum fit score or recommendation; sort by most recent or best fit.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post").optional(),
        stageId: uuidInput("pipeline stage").optional(),
        status: z.enum(APPLICATION_STATUSES).optional(),
        minFitScore: z.number().int().min(0).max(100).optional(),
        recommendation: z.enum(RECOMMENDATIONS).optional(),
        sort: z.enum(["recent", "fit"]).optional().describe("Default: recent."),
        limit: limitInput,
      }),
      execute: ({ jobPostId, stageId, status, minFitScore, recommendation, sort, limit }) =>
        withToolErrors(ctx, "listApplicants", async () => {
          const byFit = sort === "fit" || minFitScore !== undefined || recommendation !== undefined;
          const max = limit ?? AGENT_LIST_DEFAULT_LIMIT;

          let query = supabase
            .from("applications")
            .select(
              `id, status, created_at, applicant_user_id, company_candidate_id, job_postings!inner(id, title, company_id), pipeline_stages(id, name), user_info(${AGENT_CANDIDATE_COLUMNS}), company_candidates(full_name), application_screenings(status, fit_score, recommendation)`,
            )
            .eq("job_postings.company_id", company.id)
            // BI-REQ-042: a merged import shows through the application it joined.
            .is("merged_into_application_id", null);
          if (jobPostId) query = query.eq("job_post_id", jobPostId);
          if (stageId) query = query.eq("stage_id", stageId);
          if (status) query = query.eq("status", status);
          const { data, error } = await query
            .order("created_at", { ascending: false })
            .limit(byFit ? FIT_SCAN_LIMIT : max);
          if (error) throw error;

          let rows = (data ?? []).map((row) => {
            const screening = row.application_screenings as ScreeningSummary;
            const completed = screening?.status === "completed" ? screening : null;
            const candidate = row.user_info as CandidateRow | null;
            const imported = !row.applicant_user_id && !!row.company_candidate_id;
            return {
              applicationId: row.id,
              candidateId: row.applicant_user_id,
              name: imported ? importedName(row.company_candidates?.full_name) : (candidate?.full_name ?? null),
              ...(imported ? { imported: true } : {}),
              roles: (candidate?.desired_roles ?? []).slice(0, 3),
              experienceYears: candidate?.experience_years ?? null,
              job: { id: row.job_postings.id, title: row.job_postings.title },
              stage: row.pipeline_stages ? { id: row.pipeline_stages.id, name: row.pipeline_stages.name } : null,
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
              `id, status, created_at, answers, answers_v2, form_snapshot, resume_id, resume_snapshot, applicant_user_id, company_candidate_id, job_postings!inner(id, title, company_id, questions), pipeline_stages(id, name), user_info(${AGENT_CANDIDATE_COLUMNS}), company_candidates(full_name)`,
            )
            .eq("id", applicationId)
            .eq("job_postings.company_id", company.id)
            .maybeSingle();
          if (error) throw error;
          if (!application) return NOT_FOUND;

          // What was sent (RE-REQ-062). An older application reads its live
          // resume, and an imported candidate has no GetHired resume (BI-REQ-030).
          const snapshot = readResumeSnapshot(application.resume_snapshot);
          const resumes = () => supabase.from("resumes").select("content");
          const resumeQuery = snapshot
            ? null
            : application.resume_id
              ? resumes().eq("id", application.resume_id)
              : application.applicant_user_id
                ? resumes().eq("user_id", application.applicant_user_id).eq("is_primary", true)
                : null;
          const [{ data: resume }, { data: screeningRow }] = await Promise.all([
            resumeQuery ? resumeQuery.limit(1).maybeSingle() : Promise.resolve({ data: null }),
            supabase
              .from("application_screenings")
              .select(SCREENING_VIEW_COLUMNS)
              .eq("application_id", application.id)
              .maybeSingle(),
          ]);

          // AF-REQ-009: typed answers with the labels the candidate saw.
          const answerViews = answersView(application, application.job_postings.questions);
          const answers = answerViews.length
            ? wrapInSandbox(
                "application_answers",
                answerViews
                  .map(({ label, text }, i) => `Q${i + 1}: ${label}\nA${i + 1}: ${text ? scrubPII(text) : "[no answer]"}`)
                  .join("\n\n"),
              )
            : null;

          const screening = screeningRow ? toScreeningView(screeningRow) : null;
          const candidate = application.user_info as CandidateRow | null;
          const imported = !application.applicant_user_id && !!application.company_candidate_id;

          return {
            applicationId: application.id,
            stage: application.pipeline_stages
              ? { id: application.pipeline_stages.id, name: application.pipeline_stages.name }
              : null,
            status: application.status,
            appliedAt: application.created_at,
            job: { id: application.job_postings.id, title: application.job_postings.title },
            candidate: imported
              ? { name: importedName(application.company_candidates?.full_name), imported: true }
              : candidate
                ? compactCandidate(candidate)
                : null,
            answers,
            resumeExcerpt: resumeExcerpt((snapshot?.content ?? resume?.content) as TResumeRowContent | null),
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
  };
}
