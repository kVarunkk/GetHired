import { reportError } from "@/helpers/posthog/report-error";
import { render } from "react-email";
import * as React from "react";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import {
  generateInterviewAnalysis,
  interviewAnalysisExcerpt,
  InterviewAnalysisSchema,
} from "@/helpers/interview/interview-analysis";
import { CompanyInterviewAnalysisSchema } from "@/helpers/interview/company-analysis-prompt";
import { InterviewAnalysisStatusEmail } from "@/emails/InterviewAnalysisStatusEmail";
import {
  generateScreeningReport,
  loadScreeningAnalysisInput,
} from "@/helpers/interview/screening/analysis";
import { notifyCompanyOfCompletedInterview } from "@/helpers/interview/screening/notify-company";
import { storedScreeningReportSchema } from "@/helpers/interview/screening/schemas";
import { claimForRun, notUnderLiveClaim, transition } from "@/helpers/db/transition";
import type { Json } from "@/utils/types/database.types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

type AnalysisMessage = {
  msg_id: number;
  read_ct: number;
  message: { analysisId: string };
};

const BATCH_SIZE = 2;
const VISIBILITY_TIMEOUT = 300;
const MAX_RETRIES = 3;

/**
 * The states a run may claim an analysis from (SM-REQ-003). `completed` is
 * claimed only when its stored result doesn't parse, which is the one case
 * the worker re-runs a completed row.
 */
const CLAIM_FROM = ["queued", "failed", "completed"] as const;

type AnalysisRow = {
  id: string;
  perspective: string;
  status: string;
  result: unknown;
  notification_sent_at: string | null;
  claimed_at: string | null;
};

/**
 * What a run did with its message: `done` archives it. `busy` leaves it,
 * because another run holds the row (it comes back after the visibility
 * timeout). `superseded` archives it with no notification: the row was
 * re-queued or claimed again while this run went on, so its result wasn't
 * saved, and the newer run notifies.
 */
type RunOutcome = "done" | "busy" | "superseded";

/** Claims the row for this run; anything but `claimed` means don't run. */
function claim(supabase: ServiceClient, analysis: AnalysisRow, claimedAt: string) {
  return claimForRun(
    supabase,
    "interview_analyses",
    { id: analysis.id, state: analysis.status, claimedAt: analysis.claimed_at },
    { from: CLAIM_FROM, claim: claimedAt, liveForMs: VISIBILITY_TIMEOUT * 1000, patch: { error_code: null } },
  );
}

/** Saves the run's result, only if the row is still this run's. */
function saveResult(supabase: ServiceClient, analysisId: string, claimedAt: string, result: unknown) {
  const now = new Date().toISOString();
  return transition(
    supabase,
    "interview_analyses",
    { id: analysisId, claim: claimedAt },
    { from: ["processing"], to: "completed", patch: { result: result as Json, completed_at: now, updated_at: now } },
  );
}

/**
 * The job a company report is scored against (difference 10): the posting of
 * the earliest application the session is attached to.
 */
async function sharedJobFor(
  supabase: ServiceClient,
  sessionId: string,
): Promise<{ title: string; description: string } | null> {
  const { data, error } = await supabase
    .from("application_attachments")
    .select("created_at, applications!inner(job_postings!inner(title, description))")
    .eq("interview_session_id", sessionId)
    .eq("kind", "interview_session")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const job = data?.applications?.job_postings;
  return job ? { title: job.title, description: job.description ?? "" } : null;
}

function formatTranscript(turns: unknown): string {
  if (!Array.isArray(turns)) return "";

  return turns
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const turn = entry as Record<string, unknown>;
      return [
        ...(typeof turn.user === "string" && turn.user.trim()
          ? [`Candidate: ${turn.user.trim()}`]
          : []),
        ...(typeof turn.assistant === "string" && turn.assistant.trim()
          ? [`Interviewer: ${turn.assistant.trim()}`]
          : []),
      ];
    })
    .join("\n");
}

/**
 * A screening interview's company report (SI-REQ-030, spec §3.3): scored
 * against the invite's config snapshot, stored, then the company is emailed.
 * The candidate gets no email (SI-DEC-003). Throws to retry the message.
 */
async function processScreeningAnalysis(
  supabase: ServiceClient,
  analysis: AnalysisRow,
  session: { turns: unknown },
  applicationInterviewId: string | null,
  claimedAt: string,
): Promise<RunOutcome> {
  if (analysis.perspective !== "company") {
    throw new Error("A screening session only has a company analysis.");
  }
  if (!applicationInterviewId) {
    throw new Error("Screening interview has no application interview.");
  }

  if (analysis.status !== "completed" || !storedScreeningReportSchema.safeParse(analysis.result).success) {
    const { companyId, snapshot, jobDescription, turns } = await loadScreeningAnalysisInput(
      supabase,
      applicationInterviewId,
      session.turns,
    );

    if ((await claim(supabase, analysis, claimedAt)) !== "claimed") return "busy";

    const report = await generateScreeningReport({
      snapshot,
      jobDescription,
      turns,
      trace: { analysisId: analysis.id, companyId },
    });

    if (!(await saveResult(supabase, analysis.id, claimedAt, report)).applied) return "superseded";
  }

  if (!analysis.notification_sent_at) {
    await notifyCompanyOfCompletedInterview(supabase, applicationInterviewId, { scored: true });

    const { error: notificationError } = await supabase
      .from("interview_analyses")
      .update({
        notification_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysis.id)
      .is("notification_sent_at", null);
    if (notificationError) throw notificationError;
  }
  return "done";
}

async function sendAnalysisEmail(
  email: string,
  candidateName: string,
  interviewId: string,
  sessionId: string,
  result: ReturnType<typeof InterviewAnalysisSchema.parse>,
) {
  const interviewUrl = `${deploymentUrl()}/interview/${interviewId}/analysis/${sessionId}`;
  const excerpt = interviewAnalysisExcerpt(result, 500);
  const htmlContent = await render(
    React.createElement(InterviewAnalysisStatusEmail, {
      candidateName,
      excerpt,
      interviewUrl,
    }),
  );
  const textContent = await render(
    React.createElement(InterviewAnalysisStatusEmail, {
      candidateName,
      excerpt,
      interviewUrl,
    }),
    { plainText: true },
  );

  await sendEmail({
    toEmail: email,
    subject: "Your AI interview analysis is ready",
    htmlContent,
    textContent,
  });
}

async function deleteMessage(supabase: ServiceClient, messageId: number) {
  const { error } = await supabase.schema("pgmq_public").rpc("delete", {
    queue_name: "interview_analysis_queue",
    message_id: messageId,
  });
  if (error) throw error;
}

export async function GET() {
  const requestHeaders = await headers();
  if (requestHeaders.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  try {
    // Each run's claim (SM-REQ-003) is the time the message was read, so the
    // next delivery, a visibility timeout later, finds it dead.
    const claimedAt = new Date().toISOString();
    const { data, error } = await supabase.schema("pgmq_public").rpc("read", {
      queue_name: "interview_analysis_queue",
      sleep_seconds: VISIBILITY_TIMEOUT,
      n: BATCH_SIZE,
    });

    if (error) {
      throw new Error(`Failed to read interview analysis queue: ${error.message}`);
    }

    const messages = (data ?? []) as AnalysisMessage[];
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const message of messages) {
      try {
        const { data: analysis, error: analysisError } = await supabase
          .from("interview_analyses")
          .select("id, interview_session_id, perspective, status, result, notification_sent_at, claimed_at")
          .eq("id", message.message.analysisId)
          .single();

        if (analysisError || !analysis) {
          throw analysisError ?? new Error("Analysis record not found.");
        }

        const { data: session, error: sessionError } = await supabase
          .from("interview_sessions")
          .select("id, interview_id, turns")
          .eq("id", analysis.interview_session_id)
          .single();
        if (sessionError || !session) {
          throw sessionError ?? new Error("Interview session not found.");
        }

        const { data: interview, error: interviewError } = await supabase
          .from("interviews")
          .select("id, user_id, job_id, kind, application_interview_id")
          .eq("id", session.interview_id)
          .single();
        if (interviewError || !interview) {
          throw interviewError ?? new Error("Interview not found.");
        }
        if (!interview.user_id) {
          throw new Error("Interview has no candidate owner.");
        }

        if (interview.kind === "screening") {
          const outcome = await processScreeningAnalysis(
            supabase,
            analysis,
            session,
            interview.application_interview_id,
            claimedAt,
          );
          if (outcome !== "busy") await deleteMessage(supabase, message.msg_id);
          if (outcome === "done") completed++;
          else skipped++;
          continue;
        }

        // A company report (OR-REQ-031) is for the hiring team the
        // candidate shared the session with: scored against that job, and
        // no email to anyone in v1 (the applicant page shows it).
        const isCompany = analysis.perspective === "company";

        let candidate: { email: string | null; full_name: string | null } | null = null;
        if (!isCompany) {
          const { data, error: candidateError } = await supabase
            .from("user_info")
            .select("email, full_name")
            .eq("user_id", interview.user_id)
            .single();
          if (candidateError) throw candidateError;
          if (!data?.email) throw new Error("Candidate email not found.");
          candidate = data;
        }

        const schema = isCompany ? CompanyInterviewAnalysisSchema : InterviewAnalysisSchema;
        let result = schema.safeParse(analysis.result);
        if (analysis.status !== "completed" || !result.success) {
          const transcript = formatTranscript(session.turns);
          if (!transcript) {
            throw new Error("Interview session has no transcript to analyze.");
          }

          let job: { title: string; description: string } | null;
          if (isCompany) {
            job = await sharedJobFor(supabase, session.id);
            if (!job) throw new Error("No application shares this interview session.");
          } else {
            const { data, error: jobError } = interview.job_id
              ? await supabase
                  .from("all_jobs")
                  .select("job_name, description")
                  .eq("id", interview.job_id)
                  .maybeSingle()
              : { data: null, error: null };
            if (jobError) throw jobError;
            job = data ? { title: data.job_name ?? "", description: data.description ?? "" } : null;
          }

          if ((await claim(supabase, analysis, claimedAt)) !== "claimed") {
            skipped++;
            continue;
          }

          const generated = await generateInterviewAnalysis({
            perspective: isCompany ? "company" : "candidate",
            candidateName: candidate?.full_name || "Candidate",
            jobTitle: job?.title || "Role not specified",
            jobDescription: job?.description || "",
            transcript,
          });

          if (!(await saveResult(supabase, analysis.id, claimedAt, generated)).applied) {
            // Re-queued or claimed again meanwhile: the newer run notifies.
            await deleteMessage(supabase, message.msg_id);
            skipped++;
            continue;
          }
          result = schema.safeParse(generated);
        }

        if (!result.success) {
          throw new Error("Stored interview analysis has an invalid structure.");
        }

        if (!analysis.notification_sent_at) {
          // The candidate already got their own report's email; a company
          // report sends none, and is marked so it's never retried for one.
          if (!isCompany && candidate?.email) {
            await sendAnalysisEmail(
              candidate.email,
              candidate.full_name || "",
              interview.id,
              session.id,
              InterviewAnalysisSchema.parse(result.data),
            );
          }

          const { error: notificationError } = await supabase
            .from("interview_analyses")
            .update({
              notification_sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", analysis.id)
            .is("notification_sent_at", null);
          if (notificationError) throw notificationError;
        }

        await deleteMessage(supabase, message.msg_id);
        completed++;
      } catch (error) {
        failed++;
        reportError(
          `[INTERVIEW_ANALYSIS_WORKER] Message ${message.msg_id} failed:`,
          error,
        );
        await eventCaptureServerException({
          error,
          distinctId: message.message?.analysisId,
          properties: {
            flow: "interview_analysis_worker",
            queue_message_id: message.msg_id,
            attempt: message.read_ct,
          },
        });

        if (message.read_ct >= MAX_RETRIES) {
          const { data: givenUp, error: updateError } = await supabase
            .from("interview_analyses")
            .update({
              status: "failed",
              error_code: "analysis_worker_retries_exhausted",
              updated_at: new Date().toISOString(),
            })
            .eq("id", message.message.analysisId)
            .neq("status", "completed")
            // A newer run's live claim decides that row (SM-REQ-003).
            .or(notUnderLiveClaim({ claim: claimedAt, liveForMs: VISIBILITY_TIMEOUT * 1000 }))
            .select("id");
          if (updateError) throw updateError;

          await deleteMessage(supabase, message.msg_id);

          // SM-REQ-002: alert only when this give-up is what failed the row.
          if ((givenUp?.length ?? 0) > 0) {
            await sendEmailForStatusUpdate(
              `INTERVIEW ANALYSIS POISON ALERT: Analysis ${message.message.analysisId} failed after ${message.read_ct} attempts.`,
            );
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: messages.length,
      completed,
      failed,
      skipped,
    });
  } catch (error) {
    reportError("[INTERVIEW_ANALYSIS_WORKER_CRITICAL_FAILURE]:", error);
    await eventCaptureServerException({
      error,
      properties: { flow: "interview_analysis_worker" },
    });
    return NextResponse.json(
      { success: false, message: "Interview analysis worker failed." },
      { status: 500 },
    );
  }
}
