import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadCandidateContext } from "@/helpers/interview/screening/candidate-context";
import { applicantMessage } from "@/helpers/interview/screening/copy";
import type { ConfigSnapshot } from "@/helpers/interview/screening/schemas";

const JOB_DESCRIPTION_MAX_CHARS = 8000;

/** How each refusal of reserve/start_screening_attempt is answered. */
const REFUSAL_STATUS: Record<string, number> = {
  not_found: 404,
  not_invited: 409,
  active_session: 409,
  no_attempts: 409,
  reservation_expired: 409,
  expired: 410,
  no_consent: 428,
};

const refusal = (reason: string) =>
  NextResponse.json({ error: applicantMessage(reason), code: reason }, { status: REFUSAL_STATUS[reason] ?? 409 });

const voiceHeaders = () => ({
  "content-type": "application/json",
  "x-backend-secret": process.env.BACKEND_SECRET!,
});

/**
 * Starts an attempt at a screening interview (SI-REQ-021/022): reserve the
 * interview → a voice session in screening mode with the invite's snapshot
 * and the application's resume → start the attempt, which uses it up and
 * inserts the server-recorded session. The browser never writes the
 * transcript; the voice server reports it (/api/internal/interview-transcript).
 * The response matches /api/interview/start.
 */
export async function POST(req: Request) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (user.app_metadata?.type === "company") {
    return NextResponse.json({ error: "Only applicants can take an interview." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { applicationInterviewId?: unknown } | null;
  const id = body?.applicationInterviewId;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Interview ID is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const reservationId = `starting:${randomUUID()}`;
  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_screening_attempt", {
    p_id: id,
    p_reservation_id: reservationId,
  });
  const reservation = reserved as { ok: boolean; reason?: string; interview_id?: string } | null;
  if (reserveError || !reservation) {
    console.error("[SCREENING_RESERVE_ERROR]:", reserveError);
    return NextResponse.json({ error: "Unable to start the interview." }, { status: 500 });
  }
  if (!reservation.ok || !reservation.interview_id) return refusal(reservation.reason ?? "not_found");
  const interviewId = reservation.interview_id;

  const release = async () => {
    const { error } = await supabase.rpc("release_interview_session", {
      p_interview_id: interviewId,
      p_session_id: reservationId,
    });
    if (error) console.error("[SCREENING_RELEASE_ERROR]:", error);
  };

  // The snapshot holds the questions, which the applicant can't read directly.
  const admin = createServiceRoleClient();
  const { data: invite } = await admin
    .from("application_interviews")
    .select("id, application_id, interview_id, job_post_id, config_snapshot")
    .eq("id", id)
    .eq("applicant_user_id", user.id)
    .maybeSingle();
  if (!invite) {
    await release();
    return refusal("not_found");
  }
  const snapshot = invite.config_snapshot as ConfigSnapshot;
  const { data: job } = await admin.from("job_postings").select("description").eq("id", invite.job_post_id).maybeSingle();
  const candidate = await loadCandidateContext(admin, invite.application_id);
  if (!candidate.ok) console.error("[SCREENING_CONTEXT]:", id, candidate.error);

  let sessionId: string;
  try {
    const r = await fetch(`${process.env.VOICE_BACKEND_URL}/sessions`, {
      method: "POST",
      headers: voiceHeaders(),
      body: JSON.stringify({
        mode: "screening",
        interview_id: interviewId,
        candidate_name: (candidate.ok && candidate.firstName) || "there",
        profile: candidate.ok ? candidate.context : "",
        job_title: snapshot.job_title,
        job_description: (job?.description ?? "").slice(0, JOB_DESCRIPTION_MAX_CHARS),
        company_name: snapshot.company_name,
        questions: snapshot.questions.map((q) => q.text),
        competencies: snapshot.competencies,
        max_minutes: snapshot.duration_minutes,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 429) {
      await release();
      return NextResponse.json(
        { error: "Our interview server is busy. Please try again in a minute.", code: "voice_busy" },
        { status: 503 },
      );
    }
    const response = (await r.json()) as { session_id?: unknown };
    if (!r.ok || typeof response.session_id !== "string" || !response.session_id) {
      throw new Error(`Voice backend failed to create a session (${r.status}).`);
    }
    sessionId = response.session_id;
  } catch (error) {
    console.error("[SCREENING_VOICE_ERROR]:", error);
    await release();
    return NextResponse.json({ error: "Failed to create a voice session. Please try again." }, { status: 502 });
  }

  const { data: started, error: startError } = await supabase.rpc("start_screening_attempt", {
    p_id: id,
    p_reservation_id: reservationId,
    p_voice_session_id: sessionId,
  });
  const start = started as { ok: boolean; reason?: string; session_id?: string } | null;
  if (startError || !start?.ok || !start.session_id) {
    if (startError) console.error("[SCREENING_START_ERROR]:", startError);
    // The voice session exists but no attempt was recorded: take it down.
    await fetch(`${process.env.VOICE_BACKEND_URL}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: voiceHeaders(),
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => console.error("[SCREENING_VOICE_DELETE_ERROR]:", err));
    await release();
    return startError ? NextResponse.json({ error: "Unable to start the interview." }, { status: 500 }) : refusal(start?.reason ?? "not_invited");
  }

  return Response.json({
    wsUrl: `${process.env.NEXT_PUBLIC_VOICE_WS_URL}/ws/interview?session_id=${sessionId}`,
    sessionId,
    interviewSessionId: start.session_id,
  });
}
