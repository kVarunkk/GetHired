import { tool } from "ai";
import { z } from "zod";
import { setPrimaryResumeAction } from "@/app/actions/set-primary-resume";
import { createResumeReviewAction } from "@/app/actions/create-resume-review";
import { startReviewAnalysis } from "@/helpers/resume-review/start-review-analysis";
import { AgentToolContext, INSUFFICIENT_CREDITS, uuidInput, withToolErrors } from "./shared";

const MAX_SUGGESTIONS = 5;
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type ReviewAnalysis = {
  overall_feedback?: string;
  bullet_points?: {
    section: string;
    original: string;
    suggested: string;
    reason: string;
    priority: string;
  }[];
};

const reviewUrl = (reviewId: string) => `/resume-review/${reviewId}`;

export function createResumeTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  return {
    listResumes: tool({
      description:
        "List the user's uploaded resumes with whether each is primary and ready (parsed), processing, or failed.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listResumes", async () => {
          const { data, error } = await supabase
            .from("resumes")
            .select("id, name, is_primary, parsing_failed, content, created_at")
            .eq("user_id", ctx.user.id)
            .order("created_at", { ascending: false })
            .limit(20);
          if (error) throw error;

          return {
            resumes: (data ?? []).map((resume) => ({
              id: resume.id,
              name: resume.name,
              isPrimary: resume.is_primary,
              status: resume.parsing_failed ? "failed" : resume.content ? "ready" : "processing",
              createdAt: resume.created_at,
            })),
          };
        }),
    }),

    setPrimaryResume: tool({
      description:
        "Make one of the user's resumes their primary resume. Personalised job matches use the primary resume.",
      inputSchema: z.object({ resumeId: uuidInput("resume") }),
      execute: ({ resumeId }) =>
        withToolErrors(ctx, "setPrimaryResume", async () => {
          const { data: resume, error } = await supabase
            .from("resumes")
            .select("id")
            .eq("id", resumeId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;
          if (!resume) return { error: "Resume not found." };

          const result = await setPrimaryResumeAction(resumeId);
          if (!result.success) return { error: result.error ?? "Could not update the resume." };

          return { resumeId, isPrimary: true };
        }),
    }),

    requestResumeUpload: tool({
      description:
        "Ask the user to upload a resume (PDF). The app shows an upload widget; the result is the new resumeId, or cancelled if the user dismissed it.",
      inputSchema: z.object({
        reason: z
          .string()
          .max(200)
          .optional()
          .describe("Short reason shown to the user, e.g. 'so I can review it'."),
      }),
      outputSchema: z.object({
        resumeId: z.string().optional(),
        cancelled: z.boolean().optional(),
      }),
    }),

    startResumeReview: tool({
      description:
        "Start an AI review of one of the user's resumes against a job (jobId) or a pasted job description. Costs 5 AI credits once the analysis succeeds; the user must approve. Runs in the background and returns a link.",
      inputSchema: z
        .object({
          resumeId: uuidInput("resume"),
          jobId: uuidInput("job").optional(),
          jobDescription: z
            .string()
            .min(50)
            .max(4000)
            .optional()
            .describe("A job description the user pasted, when there is no jobId."),
          name: z.string().min(1).max(80).optional().describe("Optional name for the review."),
        })
        .refine((input) => Boolean(input.jobId) !== Boolean(input.jobDescription), {
          message: "Provide exactly one of jobId or jobDescription.",
        }),
      execute: ({ resumeId, jobId, jobDescription, name }) =>
        withToolErrors(ctx, "startResumeReview", async () => {
          const { data: resume, error: resumeError } = await supabase
            .from("resumes")
            .select("id, content, parsing_failed")
            .eq("id", resumeId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (resumeError) throw resumeError;
          if (!resume) return { error: "Resume not found." };
          if (resume.parsing_failed) {
            return { error: "This resume couldn't be read. Ask the user to upload it again." };
          }
          if (!resume.content) {
            return { error: "This resume is still being processed. Try again in a minute." };
          }

          const formData = new FormData();
          formData.set("existingResumeId", resumeId);
          if (jobId) formData.set("jobId", jobId);
          if (name) formData.set("name", name);

          const created = await createResumeReviewAction(formData);
          if (!("reviewId" in created) || !created.reviewId) {
            const error = created.error ?? "Could not create the review.";
            return error.startsWith("Insufficient AI credits") ? INSUFFICIENT_CREDITS : { error };
          }
          const reviewId = created.reviewId;

          if (jobDescription) {
            const { error } = await supabase
              .from("resume_reviews")
              .update({ target_jd: jobDescription })
              .eq("id", reviewId)
              .eq("user_id", ctx.user.id);
            if (error) throw error;
          }

          const started = await startReviewAnalysis(supabase, ctx.user.id, reviewId);
          if (!started.ok) {
            return started.status === 402
              ? INSUFFICIENT_CREDITS
              : { error: started.error, reviewId, url: reviewUrl(reviewId) };
          }

          return {
            reviewId,
            status: "processing",
            url: reviewUrl(reviewId),
            message:
              "The review usually takes about a minute. The user will get an email when it's ready.",
          };
        }),
    }),

    getResumeReview: tool({
      description:
        "Get a resume review's status, score, overall feedback and its top suggestions (highest priority first).",
      inputSchema: z.object({ reviewId: uuidInput("resume review") }),
      execute: ({ reviewId }) =>
        withToolErrors(ctx, "getResumeReview", async () => {
          const { data: review, error } = await supabase
            .from("resume_reviews")
            .select("id, name, status, score, analysis_failed, ai_response, created_at")
            .eq("id", reviewId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;
          if (!review) return { error: "Resume review not found." };

          const analysis = (review.ai_response ?? {}) as ReviewAnalysis;
          const bullets = analysis.bullet_points ?? [];
          const suggestions = [...bullets]
            .sort(
              (a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3),
            )
            .slice(0, MAX_SUGGESTIONS)
            .map(({ section, original, suggested, reason, priority }) => ({
              section,
              original,
              suggested,
              reason,
              priority,
            }));

          return {
            id: review.id,
            name: review.name,
            status: review.analysis_failed ? "failed" : review.status,
            score: review.score,
            overallFeedback: analysis.overall_feedback ?? null,
            suggestions,
            totalSuggestions: bullets.length,
            createdAt: review.created_at,
            url: reviewUrl(review.id),
          };
        }),
    }),
  };
}
