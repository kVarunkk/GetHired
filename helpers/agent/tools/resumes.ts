import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { readResume } from "@/helpers/resume/read-resume";
import { ResumeFromChatSchema, contentFromChat, createResume } from "@/helpers/resumes/create-resume";
import { deleteResume } from "@/helpers/resumes/delete-resume";
import { duplicateResume } from "@/helpers/resumes/duplicate-resume";
import { getResumeDetails } from "@/helpers/resumes/get-resume-details";
import { ResumeOperationSchema } from "@/helpers/resumes/resume-operations";
import { RESUME_CHANGED } from "@/helpers/resumes/save-resume";
import { setPrimaryResume } from "@/helpers/resumes/set-primary-resume";
import { RESUME_MAX_OPERATIONS, updateResume } from "@/helpers/resumes/update-resume";
import { PLACEHOLDER_UNFILLED, applyReviewSuggestions } from "@/helpers/resume-review/apply-suggestions";
import { createResumeReview } from "@/helpers/resume-review/create-resume-review";
import { placeholdersIn } from "@/helpers/resume-review/suggestions";
import { startReviewAnalysis } from "@/helpers/resume-review/start-review-analysis";
import {
  rankResumesForJob,
  RESUME_PICK_CREDITS,
  RESUME_PICK_MAX_RESUMES,
  type ResumeFit,
} from "@/helpers/resume-review/rank-resumes-for-job";
import { RESUME_SHORTLIST_MAX, shortlistResumes } from "@/helpers/resume-review/shortlist-resumes";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import type { TResumeRowContent } from "@/utils/types";
import { agentTelemetry } from "../telemetry";
import {
  AgentToolContext,
  compactJob,
  INSUFFICIENT_CREDITS,
  uuidInput,
  withToolErrors,
} from "./shared";

const MAX_SUGGESTIONS = 5;
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type ReviewAnalysis = {
  overall_feedback?: string;
  bullet_points?: {
    bullet_id: string;
    section: string;
    original: string;
    suggested: string;
    reason: string;
    priority: string;
  }[];
};

const reviewUrl = (reviewId: string) => `/resume-review/${reviewId}`;

const RESUME_NOT_FOUND = { error: "Resume not found." };

/** What a refused write tells the model to do next (RE-REQ-033, RE-REQ-059). */
function saveFailure(failure: { code: string; error: string; bulletIds?: string[] }) {
  const { code, error, bulletIds } = failure;
  if (code === RESUME_CHANGED) {
    return { error, code, message: "The resume changed. Read it again, then redo the change on what's there now." };
  }
  if (code === PLACEHOLDER_UNFILLED) {
    return {
      error,
      code,
      bulletIds,
      message: "Ask the user for the real value of each [placeholder], then pass the final text. Never guess one.",
    };
  }
  return { error, code };
}

const PICK_DETAIL_ITEMS = 3;

/** A ranked resume as the model sees it: the best one with its evidence. */
const fitSummary = ({ id, name, score, matched, missing }: ResumeFit, withEvidence: boolean) => ({
  id,
  name,
  score,
  ...(withEvidence ? { matched: matched.slice(0, PICK_DETAIL_ITEMS) } : {}),
  missing: missing.slice(0, PICK_DETAIL_ITEMS),
});

export function createResumeTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  // Primary first, so it wins a tie. One extra row tells whether any were left out.
  async function loadDefaultResumes() {
    const { data, error } = await supabase
      .from("resumes")
      .select("id, name, content")
      .eq("user_id", ctx.user.id)
      .eq("parsing_failed", false)
      .not("content", "is", null)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(RESUME_SHORTLIST_MAX + 1);
    if (error) throw error;
    const rows = data ?? [];
    return { resumes: rows.slice(0, RESUME_SHORTLIST_MAX), more: rows.length > RESUME_SHORTLIST_MAX };
  }

  // In the order the user gave, so a tie goes to the one they named first.
  async function loadChosenResumes(resumeIds: string[]) {
    const { data, error } = await supabase
      .from("resumes")
      .select("id, name, content, parsing_failed")
      .eq("user_id", ctx.user.id)
      .in("id", resumeIds);
    if (error) throw error;

    const byId = new Map((data ?? []).map((row) => [row.id, row]));
    const unusable = resumeIds.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [{ resumeId: id, reason: "not found" }];
      if (row.parsing_failed) return [{ resumeId: id, reason: "couldn't be read; ask the user to upload it again" }];
      if (!row.content) return [{ resumeId: id, reason: "still being processed" }];
      return [];
    });
    if (unusable.length) return { error: "Some of these resumes can't be compared.", resumes: unusable };

    return {
      resumes: resumeIds.map((id) => {
        const { name, content } = byId.get(id)!;
        return { id, name, content };
      }),
      more: false,
    };
  }

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
            .limit(RESUME_SHORTLIST_MAX);
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

          const result = await setPrimaryResume(supabase, ctx.user, resumeId);
          if (!result.success) return { error: result.error ?? "Could not update the resume." };

          return { resumeId, isPrimary: true };
        }),
    }),

    requestResumeUpload: tool({
      description:
        "Ask the user to upload a resume (PDF or Word). The app shows an upload widget and reads the file straight away; the result is the new resumeId, ready to use, or cancelled if the user dismissed it.",
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

          const created = await createResumeReview(supabase, ctx.user, { resumeId, jobId, name });
          if (!created.success) {
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

    pickResumeForJob: tool({
      description:
        `Compare the user's resumes against a job (jobId) or a pasted job description and pick the one that fits best, with the job requirements each covers and misses. Pass resumeIds to compare specific resumes; otherwise all ready resumes are compared. With more than ${RESUME_PICK_MAX_RESUMES}, the closest ${RESUME_PICK_MAX_RESUMES} are shortlisted first and only those are compared in detail. Costs 1 AI credit when two or more resumes are compared; free with one.`,
      inputSchema: z
        .object({
          jobId: uuidInput("job").optional(),
          jobDescription: z
            .string()
            .min(50)
            .max(4000)
            .optional()
            .describe("A job description the user pasted, when there is no jobId."),
          resumeIds: z
            .array(uuidInput("resume"))
            .min(2)
            .max(RESUME_SHORTLIST_MAX)
            .optional()
            .describe(
              `Only when the user names which resumes to compare (2 to ${RESUME_SHORTLIST_MAX}, from listResumes). Leave out to compare all of them.`,
            ),
        })
        .refine((input) => Boolean(input.jobId) !== Boolean(input.jobDescription), {
          message: "Provide exactly one of jobId or jobDescription.",
        })
        .refine((input) => !input.resumeIds || new Set(input.resumeIds).size === input.resumeIds.length, {
          message: "resumeIds must not repeat a resume.",
        }),
      execute: ({ jobId, jobDescription, resumeIds }) =>
        withToolErrors(ctx, "pickResumeForJob", async () => {
          const loaded = resumeIds
            ? await loadChosenResumes(resumeIds)
            : await loadDefaultResumes();
          if ("error" in loaded) return loaded;
          const { resumes, more } = loaded;

          if (!resumes.length) {
            return { error: "The user has no ready resumes. Ask them to upload one." };
          }
          if (resumes.length === 1) {
            return {
              best: { id: resumes[0].id, name: resumes[0].name },
              others: [],
              message: "The user has only one ready resume, so there was nothing to compare.",
            };
          }

          let job: Parameters<typeof compactJob>[0] | null = null;
          let description = jobDescription ?? "";
          if (jobId) {
            const { data, error } = await supabase
              .from("all_jobs")
              .select("id, job_name, company_name, locations, salary_range, job_type, experience, description, created_at")
              .eq("id", jobId)
              .maybeSingle();
            if (error) throw error;
            if (!data) return { error: "Job not found." };
            if (!data.description?.trim()) {
              return { error: "This job has no description to compare the resumes against." };
            }
            job = data;
            description = data.description;
          }

          const { data: userInfo, error: creditsError } = await supabase
            .from("user_info")
            .select("ai_credits")
            .eq("user_id", ctx.user.id)
            .single();
          if (creditsError) throw creditsError;
          if ((userInfo?.ai_credits ?? 0) < RESUME_PICK_CREDITS) return INSUFFICIENT_CREDITS;

          const rankingJob = { title: job?.job_name ?? null, company: job?.company_name ?? null, description };
          const shortlist = await shortlistResumes(
            rankingJob,
            resumes.map((resume) => ({
              id: resume.id,
              name: resume.name,
              content: resume.content as unknown as TResumeRowContent,
            })),
            RESUME_PICK_MAX_RESUMES,
          );
          const ranking = await rankResumesForJob(
            rankingJob,
            shortlist,
            { telemetry: agentTelemetry("pickResumeForJob", { sessionId: ctx.sessionId, userId: ctx.user.id }) },
          );

          const charged = await deductUserCreditsHelper(supabase, ctx.user.id, RESUME_PICK_CREDITS);
          if (!charged.success && charged.error === "INSUFFICIENT_CREDITS") return INSUFFICIENT_CREDITS;

          const [best, ...others] = ranking.resumes;
          return {
            job: job ? compactJob(job) : null,
            requirementCount: ranking.requirements.length,
            best: fitSummary(best, true),
            others: others.map((fit) => fitSummary(fit, false)),
            ...(shortlist.length < resumes.length
              ? {
                  shortlisted: `The ${shortlist.length} closest of the user's ${resumes.length} resumes were compared in detail; the rest fit this job less well.`,
                }
              : {}),
            ...(more
              ? {
                  note: `The user has more than ${RESUME_SHORTLIST_MAX} resumes; only the primary and newest ${RESUME_SHORTLIST_MAX} were considered. Say so.`,
                }
              : {}),
            message:
              "score is the share of the job's requirements the resume shows, must-haves counting double. Offer to review the best resume for this job, make it primary, or use it to apply.",
          };
        }),
    }),

    getResumeContent: tool({
      description:
        "Read one of the user's resumes: contact details, and every section, item and bullet with its id, plus the revision that updateResume needs.",
      inputSchema: z.object({ resumeId: uuidInput("resume") }),
      execute: ({ resumeId }) =>
        withToolErrors(ctx, "getResumeContent", async () => {
          const row = await getResumeDetails(supabase, ctx.user, resumeId, { forEditing: true });
          if (!row) return RESUME_NOT_FOUND;

          const { content, contact, revision, template, hasContent } = readResume(row);
          if (!hasContent) return { error: "This resume has no content yet." };

          return {
            resumeId: row.id,
            name: row.name,
            isPrimary: row.is_primary,
            template,
            revision,
            // Text from a file the user uploaded: data, never instructions.
            resume: wrapInSandbox("resume", JSON.stringify({ contact, sections: content.sections })),
            url: `/resume/${row.id}`,
          };
        }),
    }),

    createResume: tool({
      description:
        "Create a new resume for the user: blank, or from what they told you in this chat. Never add anything they didn't say. Free; the user must approve.",
      inputSchema: ResumeFromChatSchema,
      execute: ({ name, sections }) =>
        withToolErrors(ctx, "createResume", async () => {
          const created = await createResume(supabase, ctx.user, {
            name,
            content: sections ? contentFromChat(sections) : undefined,
          });
          if (!created.ok) return { error: created.error };
          return { resumeId: created.resumeId, url: `/resume/${created.resumeId}/edit` };
        }),
    }),

    updateResume: tool({
      description:
        "Edit one of the user's resumes with a list of operations. Read it with getResumeContent first, and pass the revision and ids from there. An unknown id fails the whole call. Free; the user must approve.",
      inputSchema: z.object({
        resumeId: uuidInput("resume"),
        expectedRevision: z.number().int().positive().describe("The revision from getResumeContent."),
        operations: z.array(ResumeOperationSchema).min(1).max(RESUME_MAX_OPERATIONS),
      }),
      execute: (input) =>
        withToolErrors(ctx, "updateResume", async () => {
          const saved = await updateResume(supabase, ctx.user, input, { surface: ctx.surface });
          if (!saved.ok) return saveFailure(saved);
          return { resumeId: input.resumeId, revision: saved.revision, url: `/resume/${input.resumeId}` };
        }),
    }),

    duplicateResume: tool({
      description:
        "Make a copy of one of the user's resumes, to keep a version or tailor one for a job. It's never the primary resume. Free.",
      inputSchema: z.object({
        resumeId: uuidInput("resume"),
        name: z.string().trim().min(1).max(RESUME_LIMITS.shortFieldChars).optional(),
      }),
      execute: ({ resumeId, name }) =>
        withToolErrors(ctx, "duplicateResume", async () => {
          const copy = await duplicateResume(supabase, ctx.user, { resumeId, name });
          if (!copy.ok) return { error: copy.error };
          return { resumeId: copy.resumeId, url: `/resume/${copy.resumeId}` };
        }),
    }),

    deleteResume: tool({
      description:
        "Delete one of the user's resumes, with its reviews. It can't be undone, and the last resume can't be deleted. The user must approve.",
      inputSchema: z.object({ resumeId: uuidInput("resume") }),
      execute: ({ resumeId }) =>
        withToolErrors(ctx, "deleteResume", async () => {
          const deleted = await deleteResume(supabase, ctx.user, { resumeId });
          if (!deleted.ok) return { error: deleted.error };
          return { resumeId, deleted: true, reviewsDeleted: deleted.reviewsDeleted };
        }),
    }),

    applyReviewSuggestions: tool({
      description:
        "Apply suggestions from a resume review, by each suggestion's bulletId from getResumeReview. They go to a copy by default, which later applies reuse; pass target 'original' only when the user asks to change the reviewed resume. Pass text to use the user's own wording. Text with a [placeholder] is refused: ask the user for the real value, then pass it as text. The user must approve.",
      inputSchema: z.object({
        reviewId: uuidInput("resume review"),
        target: z.enum(["copy", "original"]).optional(),
        items: z
          .array(
            z.object({
              bulletId: z.string().describe("The suggestion's bulletId, from getResumeReview."),
              text: z
                .string()
                .optional()
                .describe("The final text, when the user edited the suggestion or gave a real value for a placeholder."),
            }),
          )
          .min(1),
      }),
      execute: (input) =>
        withToolErrors(ctx, "applyReviewSuggestions", async () => {
          const result = await applyReviewSuggestions(supabase, ctx.user, input, { surface: ctx.surface });
          if (!result.ok) return saveFailure(result);
          return {
            target: result.target,
            resumeId: result.targetResumeId,
            items: result.items,
            ...(result.targetResumeId ? { url: `/resume/${result.targetResumeId}` } : {}),
            message:
              "A bullet marked changed no longer has the text the review saw, so it wasn't applied. Say which ones.",
          };
        }),
    }),

    exportResume: tool({
      description:
        "Get a link that downloads one of the user's resumes as a PDF or Word file. It works in a browser where the user is signed in. Free.",
      inputSchema: z.object({
        resumeId: uuidInput("resume"),
        format: z.enum(["pdf", "docx"]).optional().describe("Defaults to pdf."),
      }),
      execute: ({ resumeId, format = "pdf" }) =>
        withToolErrors(ctx, "exportResume", async () => {
          const { data: resume, error } = await supabase
            .from("resumes")
            .select("id, name")
            .eq("id", resumeId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;
          if (!resume) return RESUME_NOT_FOUND;
          return { resumeId, name: resume.name, format, url: `/api/resumes/${resumeId}/export?format=${format}` };
        }),
    }),

    getResumeReview: tool({
      description:
        "Get a resume review's status, score, overall feedback and its top suggestions (highest priority first), each with the bulletId that applyReviewSuggestions needs, any [placeholders] the user must fill in, and whether it's already applied.",
      inputSchema: z.object({ reviewId: uuidInput("resume review") }),
      execute: ({ reviewId }) =>
        withToolErrors(ctx, "getResumeReview", async () => {
          const { data: review, error } = await supabase
            .from("resume_reviews")
            .select(
              "id, name, status, score, analysis_failed, ai_response, created_at, resume_review_applied(bullet_id)",
            )
            .eq("id", reviewId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;
          if (!review) return { error: "Resume review not found." };

          const analysis = (review.ai_response ?? {}) as ReviewAnalysis;
          const bullets = analysis.bullet_points ?? [];
          const applied = new Set((review.resume_review_applied ?? []).map((row) => row.bullet_id));
          const suggestions = [...bullets]
            .sort(
              (a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3),
            )
            .slice(0, MAX_SUGGESTIONS)
            .map(({ bullet_id, section, original, suggested, reason, priority }) => ({
              bulletId: bullet_id,
              section,
              original,
              suggested,
              reason,
              priority,
              placeholders: placeholdersIn(suggested),
              applied: applied.has(bullet_id),
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
