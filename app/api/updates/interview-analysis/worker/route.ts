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

type AnalysisMessage = {
  msg_id: number;
  read_ct: number;
  message: { analysisId: string };
};

const BATCH_SIZE = 2;
const VISIBILITY_TIMEOUT = 300;
const MAX_RETRIES = 3;

/**
 * The job a company report is scored against (difference 10): the posting of
 * the earliest application the session is attached to.
 */
async function sharedJobFor(
  supabase: ReturnType<typeof createServiceRoleClient>,
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

export async function GET() {
  const requestHeaders = await headers();
  if (requestHeaders.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  try {
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

    for (const message of messages) {
      try {
        const { data: analysis, error: analysisError } = await supabase
          .from("interview_analyses")
          .select("id, interview_session_id, perspective, status, result, notification_sent_at")
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
          .select("id, user_id, job_id")
          .eq("id", session.interview_id)
          .single();
        if (interviewError || !interview) {
          throw interviewError ?? new Error("Interview not found.");
        }
        if (!interview.user_id) {
          throw new Error("Interview has no candidate owner.");
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

          const { error: processingError } = await supabase
            .from("interview_analyses")
            .update({ status: "processing", error_code: null })
            .eq("id", analysis.id);
          if (processingError) throw processingError;

          const generated = await generateInterviewAnalysis({
            perspective: isCompany ? "company" : "candidate",
            candidateName: candidate?.full_name || "Candidate",
            jobTitle: job?.title || "Role not specified",
            jobDescription: job?.description || "",
            transcript,
          });

          const { error: saveError } = await supabase
            .from("interview_analyses")
            .update({
              status: "completed",
              result: generated,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", analysis.id);
          if (saveError) throw saveError;
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

        const { error: deleteError } = await supabase
          .schema("pgmq_public")
          .rpc("delete", {
            queue_name: "interview_analysis_queue",
            message_id: message.msg_id,
          });
        if (deleteError) throw deleteError;
        completed++;
      } catch (error) {
        failed++;
        console.error(
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
          const { error: updateError } = await supabase
            .from("interview_analyses")
            .update({
              status: "failed",
              error_code: "analysis_worker_retries_exhausted",
              updated_at: new Date().toISOString(),
            })
            .eq("id", message.message.analysisId)
            .neq("status", "completed");
          if (updateError) throw updateError;

          const { error: deleteError } = await supabase
            .schema("pgmq_public")
            .rpc("delete", {
              queue_name: "interview_analysis_queue",
              message_id: message.msg_id,
            });
          if (deleteError) throw deleteError;

          await sendEmailForStatusUpdate(
            `INTERVIEW ANALYSIS POISON ALERT: Analysis ${message.message.analysisId} failed after ${message.read_ct} attempts.`,
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: messages.length,
      completed,
      failed,
    });
  } catch (error) {
    console.error("[INTERVIEW_ANALYSIS_WORKER_CRITICAL_FAILURE]:", error);
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
