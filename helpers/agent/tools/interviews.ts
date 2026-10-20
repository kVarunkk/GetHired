import { tool } from "ai";
import { z } from "zod";
import { createInterviewAction } from "@/app/actions/create-interview";
import { InterviewAnalysisSchema } from "@/helpers/interview/interview-analysis";
import { TAICredits } from "@/utils/types";
import { AGENT_LIST_DEFAULT_LIMIT } from "../config";
import { AgentToolContext, INSUFFICIENT_CREDITS, limitInput, uuidInput, withToolErrors } from "./shared";

const MAX_ITEMS = 5;
const DEFAULT_INTERVIEW_NAME = "AI Interview";

const interviewUrl = (interviewId: string) => `/interview/${interviewId}`;
const analysisUrl = (interviewId: string, sessionId: string) =>
  `/interview/${interviewId}/analysis/${sessionId}`;
const screeningUrl = (id: string) => `/interview/screening/${id}`;

type SessionRow = {
  id: string;
  started_at: string;
  status: string;
  interview_analyses: { status: string; perspective: string }[] | null;
};

export function createInterviewTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  return {
    listInterviews: tool({
      description:
        "List the user's AI mock interviews, newest first: the job and resume each is for, and each session taken with its analysis status (completed, processing, failed, or null when none).",
      inputSchema: z.object({ limit: limitInput }),
      execute: ({ limit }) =>
        withToolErrors(ctx, "listInterviews", async () => {
          const { data, error } = await supabase
            .from("interviews")
            .select(
              "id, name, created_at, all_jobs(id, job_name, company_name), resumes(id, name), interview_sessions(id, started_at, status, interview_analyses(status, perspective))",
            )
            .eq("user_id", ctx.user.id)
            .eq("kind", "practice")
            .order("created_at", { ascending: false })
            .limit(limit ?? AGENT_LIST_DEFAULT_LIMIT);
          if (error) throw error;

          return {
            interviews: (data ?? []).map((interview) => ({
              id: interview.id,
              name: interview.name ?? DEFAULT_INTERVIEW_NAME,
              createdAt: interview.created_at,
              job: interview.all_jobs
                ? {
                    id: interview.all_jobs.id,
                    title: interview.all_jobs.job_name,
                    company: interview.all_jobs.company_name,
                  }
                : null,
              resume: interview.resumes
                ? { id: interview.resumes.id, name: interview.resumes.name }
                : null,
              sessions: [...((interview.interview_sessions ?? []) as SessionRow[])]
                .sort((a, b) => b.started_at.localeCompare(a.started_at))
                .map((session) => ({
                  id: session.id,
                  startedAt: session.started_at,
                  status: session.status,
                  analysis:
                    session.interview_analyses?.find((a) => a.perspective === "candidate")
                      ?.status ?? null,
                })),
              url: interviewUrl(interview.id),
            })),
          };
        }),
    }),

    listScreeningInterviews: tool({
      description:
        "List the screening interviews companies have invited the user to after they applied, newest first: the job and company, the status (invited, paused, in_progress, completed, expired, declined, cancelled or withdrawn), the deadline, length and attempts left. These are separate from mock interviews. The company keeps the report; the user doesn't see a score.",
      inputSchema: z.object({ limit: limitInput }),
      execute: ({ limit }) =>
        withToolErrors(ctx, "listScreeningInterviews", async () => {
          // my_screening_interviews() returns the session user's rows only,
          // without the questions (SI-REQ-020).
          const { data, error } = await supabase
            .rpc("my_screening_interviews")
            .order("created_at", { ascending: false })
            .limit(limit ?? AGENT_LIST_DEFAULT_LIMIT);
          if (error) throw error;

          return {
            interviews: (data ?? []).map((interview) => ({
              id: interview.id,
              applicationId: interview.application_id,
              job: { id: interview.job_post_id, title: interview.job_title, company: interview.company_name },
              status: interview.status,
              invitedAt: interview.created_at,
              deadlineAt: interview.deadline_at,
              completedAt: interview.completed_at,
              durationMinutes: interview.duration_minutes,
              attemptsLeft: Math.max(interview.max_attempts - interview.attempts_used, 0),
              url: screeningUrl(interview.id),
            })),
          };
        }),
    }),

    getInterviewAnalysis: tool({
      description:
        "Get the feedback from one AI interview session: overall feedback, communication and role-fit scores (1-5), strengths, areas to improve and practice tips. Defaults to the latest session.",
      inputSchema: z.object({
        interviewId: uuidInput("interview"),
        sessionId: uuidInput("interview session")
          .optional()
          .describe("A session id from listInterviews; omit for the latest session."),
      }),
      execute: ({ interviewId, sessionId }) =>
        withToolErrors(ctx, "getInterviewAnalysis", async () => {
          const { data: interview, error: interviewError } = await supabase
            .from("interviews")
            .select("id, name")
            .eq("id", interviewId)
            .eq("user_id", ctx.user.id)
            .eq("kind", "practice")
            .maybeSingle();
          if (interviewError) throw interviewError;
          if (!interview) return { error: "Interview not found." };
          const name = interview.name ?? DEFAULT_INTERVIEW_NAME;

          const sessions = supabase
            .from("interview_sessions")
            .select("id, started_at, status")
            .eq("interview_id", interviewId);
          const { data: session, error: sessionError } = await (sessionId
            ? sessions.eq("id", sessionId)
            : sessions.order("started_at", { ascending: false }).limit(1)
          ).maybeSingle();
          if (sessionError) throw sessionError;
          if (!session) {
            if (sessionId) return { error: "Interview session not found." };
            return {
              interviewId,
              name,
              status: "not_started",
              message: "This interview hasn't been taken yet. The user can start it from the link.",
              url: interviewUrl(interviewId),
            };
          }

          const { data: analysis, error: analysisError } = await supabase
            .from("interview_analyses")
            .select("status, result")
            .eq("interview_session_id", session.id)
            .eq("perspective", "candidate")
            .maybeSingle();
          if (analysisError) throw analysisError;

          const base = {
            interviewId,
            name,
            sessionId: session.id,
            url: analysisUrl(interviewId, session.id),
          };

          if (analysis?.status !== "completed") {
            const status = analysis?.status ?? "pending";
            return {
              ...base,
              status,
              message:
                status === "failed"
                  ? "The analysis for this session failed."
                  : "The analysis isn't ready yet. It usually takes a few minutes after the session ends.",
            };
          }

          const parsed = InterviewAnalysisSchema.safeParse(analysis.result);
          if (!parsed.success) return { error: "This analysis couldn't be read." };
          const result = parsed.data;

          return {
            ...base,
            status: "completed",
            overallFeedback: result.overall_feedback,
            communication: result.communication,
            roleFit: result.role_fit,
            strengths: result.strengths
              .slice(0, MAX_ITEMS)
              .map(({ title, evidence }) => ({ title, evidence })),
            improvementAreas: result.improvement_areas
              .slice(0, MAX_ITEMS)
              .map(({ title, suggestion }) => ({ title, suggestion })),
            practiceTips: result.practice_tips.slice(0, MAX_ITEMS),
          };
        }),
    }),

    createInterview: tool({
      description: `Set up an AI mock interview for a job, using a resume (the primary one by default). Free to create; the user starts it from the returned link, and each session uses ${TAICredits.AI_INTERVIEW} AI credits when it starts.`,
      inputSchema: z.object({
        jobId: uuidInput("job"),
        resumeId: uuidInput("resume").optional().describe("Omit to use the primary resume."),
        name: z.string().min(1).max(80).optional().describe("Optional name for the interview."),
      }),
      execute: ({ jobId, resumeId, name }) =>
        withToolErrors(ctx, "createInterview", async () => {
          const resumes = supabase
            .from("resumes")
            .select("id, content, parsing_failed")
            .eq("user_id", ctx.user.id);
          const { data: resume, error: resumeError } = await (resumeId
            ? resumes.eq("id", resumeId)
            : resumes.eq("is_primary", true)
          ).maybeSingle();
          if (resumeError) throw resumeError;
          if (!resume) {
            return {
              error: "NO_RESUME",
              message: resumeId
                ? "Resume not found."
                : "The user has no primary resume. Ask them to upload one (requestResumeUpload) or pick one from listResumes.",
            };
          }
          if (resume.parsing_failed) {
            return { error: "This resume couldn't be read. Ask the user to upload it again." };
          }
          if (!resume.content) {
            return { error: "This resume is still being processed. Try again in a minute." };
          }

          const created = await createInterviewAction(name ?? null, resume.id, jobId);
          if (!("interviewId" in created) || !created.interviewId) {
            const error = created.error ?? "Could not create the interview.";
            return error.startsWith("Insufficient AI credits") ? INSUFFICIENT_CREDITS : { error };
          }

          return {
            interviewId: created.interviewId,
            url: interviewUrl(created.interviewId),
            message: `The interview is ready. The user starts it from the link; each session uses ${TAICredits.AI_INTERVIEW} AI credits when it starts.`,
          };
        }),
    }),
  };
}
