import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel, TelemetryOptions } from "ai";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { cleanJobText, validateAndSanitizeSearchQuery } from "@/helpers/ai/security";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { readResume } from "@/helpers/resume/read-resume";
import { getResumeDetails } from "@/helpers/resumes/get-resume-details";
import { PostHogEvent, TAICredits } from "@/utils/types";
import type { Database, Json } from "@/utils/types/database.types";
import { analyzeResumeForImprovement } from "./analyze-resume";
import { reconcileChanges, type ReviewGap } from "./changes";
import type { ReviewTarget } from "./target";

export const RESUME_IMPROVE_FOCUS_MAX_CHARS = 300;
export const RESUME_IMPROVE_JOB_MAX_CHARS = 4000;

export type ImproveResumeInput = {
  resumeId: string;
  jobId?: string;
  jobDescription?: string;
  focus?: string;
};

export type ImproveCounts = { rewrites: number; additions: number; removals: number; moves: number; gaps: number };

export type ImproveResumeResult =
  | {
      ok: true;
      reviewId: string;
      summary: string;
      counts: ImproveCounts;
      gaps: ReviewGap[];
      /** What it was tailored for, so the user is told. */
      target: ReviewTarget;
      /** For MCP, which has no card to show them (RI-REQ-054). The chat's model never sees these. */
      analysis: ReturnType<typeof reconcileChanges>;
    }
  | { ok: false; code: "INSUFFICIENT_CREDITS" | "NOT_FOUND" | "INVALID"; error: string };

const invalid = (error: string): ImproveResumeResult => ({ ok: false, code: "INVALID", error });

/**
 * RI-REQ-010–015: suggests changes to a resume, with or without a job, and saves
 * them as a review for the user to choose from. It never touches the resume. A
 * failed or stopped run throws before anything is saved or charged, so it leaves
 * nothing behind.
 */
export async function improveResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { resumeId, jobId, jobDescription, focus }: ImproveResumeInput,
  {
    model,
    abortSignal,
    telemetry,
  }: { model?: LanguageModel; abortSignal?: AbortSignal; telemetry?: TelemetryOptions } = {},
): Promise<ImproveResumeResult> {
  const startedAt = Date.now();

  const { data: userInfo, error: creditsError } = await supabase
    .from("user_info")
    .select("ai_credits")
    .eq("user_id", user.id)
    .single();
  if (creditsError) throw creditsError;
  if ((userInfo?.ai_credits ?? 0) < TAICredits.RESUME_IMPROVE) {
    return { ok: false, code: "INSUFFICIENT_CREDITS", error: "Not enough AI credits." };
  }

  const row = await getResumeDetails(supabase, user, resumeId, { forEditing: true });
  if (!row) return { ok: false, code: "NOT_FOUND", error: "Resume not found." };
  const { content, revision, hasContent } = readResume(row);
  if (!hasContent) return invalid("This resume has no content yet.");

  let job: ReviewTarget["job"] = null;
  let description = jobDescription ?? null;
  if (jobId) {
    const { data, error } = await supabase
      .from("all_jobs")
      .select("job_name, company_name, description")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, code: "NOT_FOUND", error: "Job not found." };
    if (!data.description?.trim()) return invalid("This job has no description to compare the resume against.");
    job = { id: jobId, title: data.job_name, company: data.company_name };
    description = data.description;
  }

  let cleanDescription: string | undefined;
  if (description) {
    cleanDescription = cleanJobText(description, RESUME_IMPROVE_JOB_MAX_CHARS);
    if (!cleanDescription) return invalid("This job has no description to compare the resume against.");
  }

  let cleanFocus: string | undefined;
  if (focus?.trim()) {
    const validation = validateAndSanitizeSearchQuery(focus, RESUME_IMPROVE_FOCUS_MAX_CHARS);
    if (!validation.success) return invalid(validation.error ?? "That instruction can't be used.");
    cleanFocus = validation.data;
  }

  const draft = await analyzeResumeForImprovement({
    resume: content,
    jobDescription: cleanDescription,
    focus: cleanFocus,
    model,
    abortSignal,
    telemetry,
  });
  // Stop can land as the model finishes. That run still mustn't be saved or charged.
  abortSignal?.throwIfAborted();
  const analysis = reconcileChanges(draft, content);

  const { data: saved, error: saveError } = await supabase
    .from("resume_reviews")
    .insert({
      user_id: user.id,
      resume_id: row.id,
      name: job?.title ?? `Improve ${row.name ?? "resume"}`,
      job_id: jobId ?? null,
      target_jd: description,
      focus: cleanFocus ?? null,
      ai_response: analysis as unknown as Json,
      score: null,
      status: "completed",
      analysis_failed: false,
      resume_revision: revision,
    })
    .select("id")
    .single();
  if (saveError) throw saveError;

  const charged = await deductUserCreditsHelper(supabase, user.id, TAICredits.RESUME_IMPROVE);
  if (!charged.success && charged.error === "INSUFFICIENT_CREDITS") {
    return { ok: false, code: "INSUFFICIENT_CREDITS", error: "Not enough AI credits." };
  }

  const kinds = { add: 0, remove: 0, move: 0 };
  for (const change of analysis.changes) kinds[change.kind] += 1;
  const counts: ImproveCounts = {
    rewrites: analysis.bullet_points.length,
    additions: kinds.add,
    removals: kinds.remove,
    moves: kinds.move,
    gaps: analysis.gaps.length,
  };

  after(() =>
    eventCaptureServer({
      event: PostHogEvent.ResumeImproveRun,
      distinctId: user.id,
      properties: { has_job: !!description, ...counts, duration_ms: Date.now() - startedAt },
    }),
  );

  return {
    ok: true,
    reviewId: saved.id,
    summary: analysis.overall_feedback,
    counts,
    gaps: analysis.gaps,
    target: { job, pastedJob: !job && Boolean(cleanDescription), focus: cleanFocus ?? null },
    analysis,
  };
}
