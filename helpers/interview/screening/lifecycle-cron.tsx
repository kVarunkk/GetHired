import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import { render } from "react-email";
import type { SupabaseClient } from "@supabase/supabase-js";
import InterviewExpiredEmail from "@/emails/InterviewExpiredEmail";
import InterviewReminderEmail from "@/emails/InterviewReminderEmail";
import { sendEmail } from "@/utils/email";
import type { Database, Json } from "@/utils/types/database.types";
import { createClaimLink } from "@/helpers/candidates/claim-token";
import { unsubscribeUrl } from "@/helpers/candidates/unsubscribe-token";
import { screeningInterviewUrl } from "./invite";
import { interviewPeople } from "./people";
import {
  companyApplicantUrl,
  completedUnscored,
  interviewRecipientEmails,
  notifyCompanyOfCompletedInterview,
} from "./notify-company";
import { transcriptCallbackSchema, type ConfigSnapshot } from "./schemas";

type Admin = SupabaseClient<Database>;

export const REMINDER_HOURS_BEFORE = 48;
/** A session gets this long past its length for the voice server's callback. */
export const CALLBACK_GRACE_MINUTES = 10;
const SWEEP_BATCH = 50;
/** The shortest interview plus the grace: nothing younger can be stuck. */
const SWEEP_MIN_AGE_MINUTES = 10 + CALLBACK_GRACE_MINUTES;

async function sendRendered(toEmail: string, subject: string, message: React.ReactElement) {
  const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
  await sendEmail({ toEmail, subject, htmlContent, textContent });
}

/**
 * Invites still `invited` at their deadline become `expired`; the candidate
 * and the company are both told (SI-REQ-014). An imported applicant who
 * hasn't claimed it is told at their candidate email with the unsubscribe
 * link, unless they unsubscribed (BI-REQ-034). Returns how many expired.
 */
export async function expireInterviews(admin: Admin): Promise<number> {
  const { data: ids, error } = await admin.rpc("expire_screening_interviews");
  if (error) throw new Error(`expire_screening_interviews failed: ${error.message}`);
  const expired = (ids ?? []) as string[];
  if (expired.length === 0) return 0;

  const { data: interviews } = await admin
    .from("application_interviews")
    .select("id, company_id, job_post_id, application_id, applicant_user_id, company_candidate_id, config_snapshot")
    .in("id", expired);
  const personOf = await interviewPeople(admin, interviews ?? []);

  for (const interview of interviews ?? []) {
    const snapshot = interview.config_snapshot as ConfigSnapshot;
    const person = personOf(interview);
    const subject = `Your AI interview for ${snapshot.job_title} expired`;
    try {
      if (person?.email) {
        await sendRendered(
          person.email,
          subject,
          <InterviewExpiredEmail
            audience="candidate"
            companyName={snapshot.company_name}
            jobTitle={snapshot.job_title}
            unsubscribeUrl={person.candidateId ? unsubscribeUrl(person.candidateId) : null}
          />,
        );
      }
      const candidateName = person?.fullName?.trim() || "A candidate";
      const recipients = await interviewRecipientEmails(admin, interview.company_id, interview.job_post_id);
      for (const toEmail of recipients) {
        await sendRendered(
          toEmail,
          `${candidateName}'s AI interview invite expired`,
          <InterviewExpiredEmail
            audience="company"
            companyName={snapshot.company_name}
            jobTitle={snapshot.job_title}
            candidateName={candidateName}
            applicantUrl={companyApplicantUrl(interview.application_id)}
          />,
        );
      }
    } catch (err) {
      reportError("[screening cron] expiry email failed", interview.id, err);
    }
  }
  return expired.length;
}

/**
 * One reminder, 48 hours before the deadline, for an interview not started
 * yet. The update claims the rows (reminder_sent_at), so two runs never
 * send twice. An imported applicant who hasn't claimed it gets a new claim
 * link and the unsubscribe link, unless they unsubscribed (BI-REQ-034/041).
 */
export async function sendReminders(admin: Admin): Promise<number> {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 3_600_000);
  const { data: claimed, error } = await admin
    .from("application_interviews")
    .update({ reminder_sent_at: now.toISOString() })
    .eq("status", "invited")
    .eq("attempts_used", 0)
    .is("reminder_sent_at", null)
    .lte("deadline_at", until.toISOString())
    .gt("deadline_at", now.toISOString())
    .select("id, company_id, applicant_user_id, company_candidate_id, deadline_at, config_snapshot");
  if (error) throw new Error(`Couldn't claim reminders: ${error.message}`);
  if (!claimed?.length) return 0;

  const personOf = await interviewPeople(admin, claimed);
  for (const interview of claimed) {
    const person = personOf(interview);
    if (!person?.email) continue;
    const snapshot = interview.config_snapshot as ConfigSnapshot;
    try {
      const interviewUrl = person.candidateId
        ? await createClaimLink(admin, {
            companyId: interview.company_id,
            candidateId: person.candidateId,
            applicationInterviewId: interview.id,
            expiresAt: interview.deadline_at,
          })
        : screeningInterviewUrl(interview.id);
      await sendRendered(
        person.email,
        `Reminder: your AI interview for ${snapshot.job_title}`,
        <InterviewReminderEmail
          companyName={snapshot.company_name}
          jobTitle={snapshot.job_title}
          durationMinutes={snapshot.duration_minutes}
          deadlineAt={interview.deadline_at}
          interviewUrl={interviewUrl}
          unsubscribeUrl={person.candidateId ? unsubscribeUrl(person.candidateId) : null}
        />,
      );
    } catch (err) {
      reportError("[screening cron] reminder failed", interview.id, err);
    }
  }
  return claimed.length;
}

type ActiveSession = {
  id: string;
  voice_session_id: string;
  started_at: string;
  interviews: {
    application_interview_id: string | null;
    application_interviews: { config_snapshot: Json } | null;
  } | null;
};

/** The voice server's undelivered callback for a session, or null. */
async function recoveredResult(voiceSessionId: string) {
  try {
    const r = await fetch(`${process.env.VOICE_BACKEND_URL}/sessions/${encodeURIComponent(voiceSessionId)}/result`, {
      headers: { "x-backend-secret": process.env.BACKEND_SECRET! },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const parsed = transcriptCallbackSchema.safeParse(await r.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Server-recorded sessions still active past their length + 10 minutes: the
 * callback never arrived. Uses the voice server's stored result when it has
 * one, else ends the session as no_callback (SI-REQ-024).
 */
export async function sweepSessions(admin: Admin): Promise<number> {
  const now = Date.now();
  const { data, error } = await admin
    .from("interview_sessions")
    .select(
      "id, voice_session_id, started_at, interviews!inner(application_interview_id, application_interviews!interviews_application_interview_id_fkey(config_snapshot))",
    )
    .eq("status", "active")
    .eq("transcript_source", "server")
    .lt("started_at", new Date(now - SWEEP_MIN_AGE_MINUTES * 60_000).toISOString())
    .order("started_at")
    .limit(SWEEP_BATCH);
  if (error) throw new Error(`Couldn't load active sessions: ${error.message}`);

  let swept = 0;
  for (const session of (data ?? []) as unknown as ActiveSession[]) {
    const snapshot = session.interviews?.application_interviews?.config_snapshot as ConfigSnapshot | undefined;
    const minutes = (snapshot?.duration_minutes ?? 20) + CALLBACK_GRACE_MINUTES;
    if (new Date(session.started_at).getTime() + minutes * 60_000 > now) continue;

    const result = await recoveredResult(session.voice_session_id);
    const { data: finished, error: finishError } = await admin.rpc("finish_screening_session", {
      p_session_id: session.id,
      p_turns: (result?.turns ?? []) as unknown as Json,
      p_end_reason: result?.endReason ?? "no_callback",
      p_duration_seconds: (result?.durationSeconds ?? null) as number,
    });
    if (finishError) {
      reportError("[screening cron] sweep failed", session.id, finishError.message);
      continue;
    }
    const applicationInterviewId = session.interviews?.application_interview_id;
    if (applicationInterviewId && completedUnscored(finished)) {
      await notifyCompanyOfCompletedInterview(admin, applicationInterviewId, { scored: false });
    }
    swept += 1;
  }
  return swept;
}
