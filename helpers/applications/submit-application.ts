import { reportError } from "@/helpers/posthog/report-error";
import { after } from "next/server";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { evaluateKnockouts } from "@/helpers/applications/evaluate-knockouts";
import { KNOCKOUT_EMAIL_DELAY_MS, rejectForKnockout } from "@/helpers/applications/knockout-reject";
import { validateAnswers } from "@/helpers/applications/validate-answers";
import { isTextType, liveQuestions, readApplicationForm } from "@/helpers/jobs/application-form-schema";
import { publicApplicationForm, withRules } from "@/helpers/jobs/public-application-form";
import {
  getScreeningInviteForApplication,
  type ScreeningInviteSummary,
} from "@/helpers/interview/screening/my-interviews";
import { PostHogEvent, TAICredits } from "@/utils/types";
import type { Database, Json } from "@/utils/types/database.types";

const inputSchema = z
  .object({
    allJobsId: z.string().uuid(),
    resumeId: z.string().uuid(),
    answers: z.record(z.unknown()),
    source: z.enum(["applied", "careers_page"]).optional(),
    ref: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .optional(),
  })
  .strict();

export type SubmitApplicationInput = z.input<typeof inputSchema>;
export type SubmitApplicationResult =
  | { ok: true; applicationId: string; creditsDeducted: boolean; interview: ScreeningInviteSummary | null }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const BAD_INPUT = "Something's off with this application. Reload the page and try again.";
const NOT_OPEN = "This job isn't taking applications.";
const ALREADY_APPLIED = "You've already applied to this job.";

/**
 * AF-REQ-007: applies to a platform job, for the apply form's server action
 * and the agent's submitApplication tool. Validates the answers against the
 * job's form, evaluates its knockout rules and writes the application with
 * typed answers and a snapshot of the form. `user` is the session's applicant
 * and `supabase` their client; the job, form and rules come from the database.
 *
 * AF-CON-001: the browser insert path stays open for the deployed client, so
 * the row goes in through the user's client like before (same RLS, same
 * triggers), with `answers` filled for the old readers.
 */
export async function submitApplication(
  supabase: SupabaseClient<Database>,
  user: User,
  input: SubmitApplicationInput,
): Promise<SubmitApplicationResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_INPUT };
  const { allJobsId, resumeId, answers: rawAnswers, source = "applied", ref } = parsed.data;

  const { data: resume } = await supabase
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!resume) return { ok: false, error: "Pick one of your resumes." };

  const service = createServiceRoleClient();
  const { data: job, error: jobError } = await service
    .from("job_postings")
    .select("id, job_id, company_id, status, questions, application_form")
    .eq("job_id", allJobsId)
    .maybeSingle();
  if (jobError) {
    reportError("[apply] couldn't load the job", jobError.message);
    return { ok: false, error: "Couldn't send your application. Please try again." };
  }
  if (!job || job.status !== "active") return { ok: false, error: NOT_OPEN };

  const [{ data: ruleRow }, { data: existing }] = await Promise.all([
    service.from("job_posting_form_rules").select("rules").eq("job_post_id", job.id).maybeSingle(),
    service.from("applications").select("id").eq("job_post_id", job.id).eq("applicant_user_id", user.id).limit(1),
  ]);
  if (existing && existing.length > 0) return { ok: false, error: ALREADY_APPLIED };

  const form = withRules(readApplicationForm(job.application_form, job.questions), ruleRow?.rules ?? null);
  const checked = validateAnswers(form, rawAnswers);
  if (!checked.ok) {
    return {
      ok: false,
      error: checked.formError ?? "Check your answers and try again.",
      ...(checked.formError ? {} : { fieldErrors: checked.fieldErrors }),
    };
  }
  const answers = checked.answers;
  const knockout = evaluateKnockouts(form, answers);

  // What the old readers show: the answers to the questions in job_postings.questions.
  const legacyAnswers = liveQuestions(form)
    .filter((q) => q.required && isTextType(q.type))
    .map((q) => String(answers[q.id] ?? ""));

  // An application to a company whose outreach the candidate answered
  // Interested counts as outreach (the pipeline trigger did this for inserts
  // made as the user; this one is the service role's).
  const { data: interested } = await service
    .from("candidate_outreach")
    .select("id")
    .eq("company_id", job.company_id)
    .eq("candidate_user_id", user.id)
    .eq("status", "interested")
    .limit(1);

  // BW-F02: applicants can't insert platform applications themselves, so the
  // insert is the service role's, after the checks above.
  const { data: application, error: insertError } = await service
    .from("applications")
    .insert({
      job_post_id: job.id,
      all_jobs_id: allJobsId,
      applicant_user_id: user.id,
      resume_id: resumeId,
      status: "submitted",
      answers: legacyAnswers,
      answers_v2: answers as Json,
      form_snapshot: publicApplicationForm(form) as unknown as Json,
      source: interested && interested.length > 0 ? "outreach" : source,
      source_detail: ref ? ref.toLowerCase() : null,
    })
    .select("id")
    .single();
  // The unique index catches a second submit racing past the check above.
  if (insertError?.code === "23505") return { ok: false, error: ALREADY_APPLIED };
  if (insertError || !application) {
    reportError("[apply] insert failed", insertError?.message);
    return { ok: false, error: "Couldn't send your application. Please try again." };
  }

  // AF-DEC-002: a reject rule moves it to Rejected now and emails in 24 hours.
  // Without a Rejected stage (or if the move fails) it's only flagged.
  let actionTaken = knockout.action;
  if (knockout.action === "rejected") {
    const moved = await rejectForKnockout(service, {
      applicationId: application.id,
      companyId: job.company_id,
      candidateUserId: user.id,
    });
    if (!moved) actionTaken = "flagged";
  }

  // Company-only (AF-SEC-003). A passing row too, so "Met requirements" can filter.
  const { error: knockoutError } = await service.from("application_knockouts").insert({
    application_id: application.id,
    company_id: job.company_id,
    job_post_id: job.id,
    failed: knockout.failed,
    reasons: knockout.reasons as unknown as Json,
    action_taken: actionTaken,
    ...(actionTaken === "rejected"
      ? { reject_email_due_at: new Date(Date.now() + KNOCKOUT_EMAIL_DELAY_MS).toISOString() }
      : {}),
  });
  if (knockoutError) reportError("[apply] couldn't record knockouts", knockoutError.message);

  let creditsDeducted = false;
  try {
    await deductUserCreditsHelper(supabase, user.id, TAICredits.JOB_APPLICATION);
    creditsDeducted = true;
  } catch (err) {
    reportError("[apply] credit deduction failed", err);
  }

  // SIT-050: invites usually come later, from the fit-threshold screening
  // worker, so this is mostly null; the card shows when one already exists.
  const interview = await getScreeningInviteForApplication(supabase, application.id);

  after(async () => {
    try {
      await eventCaptureServer({
        event: PostHogEvent.InHouseApplicationSubmitted,
        distinctId: user.id,
        properties: { job_id: allJobsId, source, knockout: knockout.action },
      });
    } catch {}
  });

  return { ok: true, applicationId: application.id, creditsDeducted, interview };
}
