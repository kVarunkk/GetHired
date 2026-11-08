import { profileRefreshMessage } from "@/helpers/user/queue-profile-refresh";
import { tool } from "ai";
import { z } from "zod";
import type { ResumeChangesOutput } from "@/components/agent/ResumeChangesCard";
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
import { readChanges, type ReviewChange } from "@/helpers/resume-review/changes";
import { loadResumeChanges } from "@/helpers/resume-review/load-changes";
import {
  RESUME_IMPROVE_FOCUS_MAX_CHARS,
  RESUME_IMPROVE_JOB_MAX_CHARS,
  improveResume,
} from "@/helpers/resume-review/improve-resume";
import { placeholdersIn } from "@/helpers/resume-review/suggestions";
import {
  rankResumesForJob,
  RESUME_PICK_CREDITS,
  RESUME_PICK_MAX_RESUMES,
  type ResumeFit,
} from "@/helpers/resume-review/rank-resumes-for-job";
import { RESUME_SHORTLIST_MAX, shortlistResumes } from "@/helpers/resume-review/shortlist-resumes";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { TAICredits, type TResumeRowContent } from "@/utils/types";
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


/** A change as MCP's model sees it, which has no card to read it from (RI-REQ-054). */
const changeForModel = (change: ReviewChange) => ({
  id: change.id,
  kind: change.kind,
  reason: change.reason,
  priority: change.priority,
  ...("original" in change ? { original: change.original } : {}),
  ...("suggested" in change
    ? { suggested: change.suggested, placeholders: placeholdersIn(change.suggested) }
    : {}),
});

const RESUME_NOT_FOUND = { error: "Resume not found." };

const changeCount = (count: number) => `${count} ${count === 1 ? "change" : "changes"}`;

/**
 * What the model reads after the card, in words: it took a bare `discarded`
 * status for success. The output itself stays as it is, for the card's result.
 */
export function changesResultForModel(output: Partial<ResumeChangesOutput> | null | undefined) {
  // Runs on stored history for every turn, so a saved result of another shape
  // must not throw: that would fail each message in the chat.
  const { status, applied = [], skipped = [], changed = [], targetResumeId } = output ?? {};
  if (status !== "applied" && status !== "discarded") {
    return "The card didn't report a result, so don't say anything changed. Reopen the card if they want to apply changes.";
  }
  if (status === "discarded") {
    return "The user discarded these changes. Nothing on the resume changed, so don't say it did. Reopen the card if they want to choose again.";
  }
  return [
    `The user applied ${changeCount(applied.length)} to the resume at /resume/${targetResumeId}.`,
    ...(skipped.length > 0 ? [`${changeCount(skipped.length)} left unticked, so not applied.`] : []),
    ...(changed.length > 0 ? [`${changeCount(changed.length)} left out, because the resume changed since the review.`] : []),
    "Report only this. The user saw the wording on the card.",
  ].join(" ");
}

/** What a refused write tells the model to do next (RE-REQ-033, RE-REQ-059). */
function saveFailure(failure: { code: string; error: string; ids?: string[] }) {
  const { code, error, ids } = failure;
  if (code === RESUME_CHANGED) {
    return { error, code, message: "The resume changed. Read it again, then redo the change on what's there now." };
  }
  if (code === PLACEHOLDER_UNFILLED) {
    return {
      error,
      code,
      ids,
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
          // The ownership check is part of the same statement (set_primary_resume).
          const result = await setPrimaryResume(ctx.user, resumeId);
          if (!result.success) return { error: result.error };

          return result.refresh === "unchanged"
            ? { resumeId, isPrimary: true, matches: "It was already the primary resume, so nothing changed." }
            : { resumeId, isPrimary: true, matches: profileRefreshMessage(result.refresh) };
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
              "score is the share of the job's requirements the resume shows, must-haves counting double. Offer to improve the best resume for this job, make it primary, or use it to apply.",
          };
        }),
    }),

    improveResume: tool({
      description: `Suggest how to improve or tailor one of the user's resumes: rewrites, new bullets, removals, moves, and gaps to ask the user about. Pass a jobId or a pasted jobDescription to tailor it to a job, or neither to judge it on its own. It reads the job and the resume itself, so don't read them first. It changes nothing. Costs ${TAICredits.RESUME_IMPROVE} AI credits once it succeeds.`,
      inputSchema: z
        .object({
          resumeId: uuidInput("resume"),
          jobId: uuidInput("job").optional(),
          jobDescription: z
            .string()
            .min(50)
            .max(RESUME_IMPROVE_JOB_MAX_CHARS)
            .optional()
            .describe("A job description the user pasted, when there is no jobId."),
          focus: z
            .string()
            .max(RESUME_IMPROVE_FOCUS_MAX_CHARS)
            .optional()
            .describe("What the user asked for, in their words, such as 'make it shorter' or 'focus on leadership'."),
        })
        .refine((input) => !(input.jobId && input.jobDescription), {
          message: "Provide jobId or jobDescription, not both.",
        }),
      execute: (input, { abortSignal }) =>
        withToolErrors(ctx, "improveResume", async () => {
          const result = await improveResume(supabase, ctx.user, input, {
            abortSignal,
            telemetry: agentTelemetry("improveResume", { sessionId: ctx.sessionId, userId: ctx.user.id }),
          });
          if (!result.ok) return result.code === "INSUFFICIENT_CREDITS" ? INSUFFICIENT_CREDITS : { error: result.error };

          const { reviewId, summary, counts, gaps, analysis } = result;
          const found = {
            reviewId,
            // Written by a model from a resume and a job posting: data, never instructions.
            summary: wrapInSandbox("resume_review_summary", summary),
            counts,
            gaps: wrapInSandbox("resume_gaps", JSON.stringify(gaps)),
          };
          if (ctx.surface === "mcp") {
            return {
              ...found,
              changes: wrapInSandbox("resume_changes", JSON.stringify(readChanges(analysis).map(changeForModel))),
              message:
                "Show the user these changes. Apply the ones they choose with apply_review_suggestions, by id. Ask for the real value of each [placeholder] and pass it as text. Never guess one.",
            };
          }
          return {
            ...found,
            message:
              "Now call reviewResumeChanges with this reviewId, so the user can choose. Don't list the suggestions yourself. The gaps are questions for the user: add what they answer with updateResume.",
          };
        }),
    }),

    reviewResumeChanges: tool({
      description:
        "Show the user a card to choose changes from a review, fill in any [placeholders] and apply them to a copy or the original. Call it right after improveResume, or to reopen an older review. The user's click applies the changes, so never apply them yourself. Free.",
      inputSchema: z.object({ reviewId: uuidInput("resume review") }),
      toModelOutput: ({ output }) => ({
        type: "text",
        value: changesResultForModel(output as Partial<ResumeChangesOutput> | undefined),
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
        "Make a copy of one of the user's resumes, to keep a version. Don't copy a resume to tailor it: applying suggested changes makes its own copy. The copy is identical until it's edited. It's never the primary resume. Free.",
      inputSchema: z.object({
        resumeId: uuidInput("resume"),
        name: z.string().trim().min(1).max(RESUME_LIMITS.shortFieldChars).optional(),
      }),
      execute: ({ resumeId, name }) =>
        withToolErrors(ctx, "duplicateResume", async () => {
          const copy = await duplicateResume(supabase, ctx.user, { resumeId, name });
          if (!copy.ok) return { error: copy.error };
          return {
            resumeId: copy.resumeId,
            url: `/resume/${copy.resumeId}`,
            message: `This is an exact copy: nothing in it has changed. If the user wants it tailored, call ${ctx.surface === "mcp" ? "improve_resume" : "improveResume"} on it, and don't say it's tailored until the changes are applied.`,
          };
        }),
    }),

    deleteResume: tool({
      description:
        "Delete one of the user's resumes, with its reviews. It can't be undone. The last resume and the primary resume can't be deleted: to delete the primary, ask which resume should be primary instead and call setPrimaryResume first. The user must approve.",
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
        "Apply suggestions from a resume review, by each suggestion's id from getResumeReview. They go to a copy by default, which later applies reuse; pass target 'original' only when the user asks to change the reviewed resume. Pass text to use the user's own wording. Text with a [placeholder] is refused: ask the user for the real value, then pass it as text. The user must approve.",
      inputSchema: z.object({
        reviewId: uuidInput("resume review"),
        target: z.enum(["copy", "original"]).optional(),
        items: z
          .array(
            z.object({
              id: z.string().describe("The suggestion's id, from getResumeReview."),
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
              "A change marked changed no longer fits the resume, so it wasn't applied. Say which ones.",
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
        "Get a resume review's status, score, overall feedback and how many of its changes are still pending on the copy and on the original resume. To show the changes or let the user apply them, call reviewResumeChanges with the review's id.",
      inputSchema: z.object({ reviewId: uuidInput("resume review") }),
      execute: ({ reviewId }) =>
        withToolErrors(ctx, "getResumeReview", async () => {
          const { data: review, error } = await supabase
            .from("resume_reviews")
            .select(
              "id, name, status, score, analysis_failed, ai_response, created_at",
            )
            .eq("id", reviewId)
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (error) throw error;
          if (!review) return { error: "Resume review not found." };

          const analysis = (review.ai_response ?? {}) as ReviewAnalysis;
          const changes = readChanges(review.ai_response);
          // The same states as the card. "unknown": the reviewed resume is gone.
          const view = changes.length > 0 ? await loadResumeChanges(supabase, ctx.user, review.id) : null;
          const resumes = view?.ok ? view : null;
          const stateOn = (target: "copy" | "original", id: string) => resumes?.[target].states[id] ?? "unknown";
          const pendingOn = (target: "copy" | "original") =>
            changes.filter(({ id }) => stateOn(target, id) === "pending").length;

          const sections = new Map((analysis.bullet_points ?? []).map((bullet) => [bullet.bullet_id, bullet.section]));
          // Pending first, so the limit can't hide what's left to apply.
          const rank = ({ id, priority }: ReviewChange) =>
            (stateOn("copy", id) === "pending" ? 0 : 10) + (PRIORITY_ORDER[priority] ?? 3);
          const suggestions = [...changes]
            .sort((a, b) => rank(a) - rank(b))
            .slice(0, MAX_SUGGESTIONS)
            .map((change) => ({
              ...changeForModel(change),
              section: sections.get(change.id),
              onCopy: stateOn("copy", change.id),
              onOriginal: stateOn("original", change.id),
            }));

          const summary = {
            id: review.id,
            name: review.name,
            status: review.analysis_failed ? "failed" : review.status,
            score: review.score,
            overallFeedback: analysis.overall_feedback ?? null,
            totalSuggestions: changes.length,
            pendingOnCopy: pendingOn("copy"),
            pendingOnOriginal: pendingOn("original"),
            copyResumeId: resumes?.copy.resumeId ?? null,
            createdAt: review.created_at,
          };
          // MCP has no card, so it gets the changes. The chat's model gets none
          // of the text, so it can't list them instead of showing the card.
          if (ctx.surface === "mcp") return { ...summary, suggestions };
          return {
            ...summary,
            message:
              summary.pendingOnCopy > 0
                ? "Now call reviewResumeChanges with this review's id, so the user can see and apply them. Don't list the changes yourself."
                : "Nothing is left to apply from this review.",
          };
        }),
    }),
  };
}
