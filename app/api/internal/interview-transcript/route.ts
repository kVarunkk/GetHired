import { createHash, timingSafeEqual } from "crypto";
import { after, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  completedUnscored,
  notifyCompanyOfCompletedInterview,
} from "@/helpers/interview/screening/notify-company";
import { transcriptCallbackSchema } from "@/helpers/interview/screening/schemas";
import type { Json } from "@/utils/types/database.types";

/** Constant-time, whatever the lengths (both sides are hashed first). */
function secretMatches(given: string | null): boolean {
  const expected = process.env.VOICE_CALLBACK_SECRET;
  if (!expected || !given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The voice server's report of a finished screening session (SI-SEC-001/004,
 * SI-REQ-024): the transcript, why it ended and how long it took. Accepted
 * only for a session start_screening_attempt registered, and idempotent: a
 * repeat for a finished session returns the stored outcome. Practice sessions
 * are ignored (their transcript is the browser's). Public in the middleware;
 * the secret is the only way in.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-voice-callback-secret"))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const parsed = transcriptCallbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 });
  }
  const { interviewId, voiceSessionId, turns, endReason, durationSeconds } = parsed.data;

  const admin = createServiceRoleClient();
  const { data: session, error: lookupError } = await admin
    .from("interview_sessions")
    .select("id, interviews!inner(kind, application_interview_id)")
    .eq("interview_id", interviewId)
    .eq("voice_session_id", voiceSessionId)
    .maybeSingle();
  if (lookupError) {
    console.error("[interview-transcript] lookup failed", lookupError.message);
    return NextResponse.json({ message: "Couldn't record the transcript." }, { status: 500 });
  }
  if (!session) return NextResponse.json({ message: "Unknown session." }, { status: 404 });
  const interview = session.interviews as { kind?: string; application_interview_id?: string | null } | null;
  if (interview?.kind !== "screening") {
    return NextResponse.json({ status: "ignored" }, { status: 202 });
  }

  const { data, error } = await admin.rpc("finish_screening_session", {
    p_session_id: session.id,
    p_turns: turns as unknown as Json,
    p_end_reason: endReason,
    p_duration_seconds: durationSeconds,
  });
  if (error || !data) {
    console.error("[interview-transcript] finish failed", session.id, error?.message);
    return NextResponse.json({ message: "Couldn't record the transcript." }, { status: 500 });
  }
  // A scored interview's email comes from the analysis worker.
  const applicationInterviewId = interview.application_interview_id;
  if (applicationInterviewId && completedUnscored(data)) {
    after(() => notifyCompanyOfCompletedInterview(admin, applicationInterviewId, { scored: false }));
  }
  return NextResponse.json(data, { status: 200 });
}
