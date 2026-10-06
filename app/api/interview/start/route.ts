import { loadInterviewData } from "@/helpers/interview/loadInterviewData";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const { interviewId } = await req.json();
  if (typeof interviewId !== "string" || !interviewId) {
    return NextResponse.json(
      { error: "Interview ID is required." },
      { status: 400 },
    );
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, user_info(filled)")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .single();

  if (!interview) {
    return NextResponse.json(
      { error: "Interview not found." },
      { status: 404 },
    );
  }

  if (!interview.user_info?.filled) {
    return NextResponse.json(
      {
        error:
          "User profile is incomplete. Please complete onboarding to use this feature.",
      },
      { status: 400 },
    );
  }

  const { profile, job } = await loadInterviewData(user.id, interviewId);

  const reservationId = `starting:${randomUUID()}`;
  const { data: reservationResult, error: reservationError } =
    await supabase.rpc("reserve_interview_session", {
      p_interview_id: interviewId,
      p_reservation_id: reservationId,
    });

  if (reservationError) {
    console.error("[INTERVIEW_SESSION_RESERVATION_ERROR]:", reservationError);
    return NextResponse.json(
      { error: "Unable to reserve an interview session." },
      { status: 500 },
    );
  }

  if (reservationResult !== "reserved") {
    return NextResponse.json(
      {
        error:
          "An interview session is already active. Stop it before starting another.",
      },
      { status: 409 },
    );
  }

  let activatedSessionId: string | null = null;

  try {
    const r = await fetch(`${process.env.VOICE_BACKEND_URL}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-backend-secret": process.env.BACKEND_SECRET!,
      },
      body: JSON.stringify({
        candidate_name: profile.name,
        profile: profile.text,
        job_title: job.title,
        job_description: job.description,
        interview_id: interviewId,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const response = (await r.json()) as { session_id?: unknown };
    if (
      !r.ok ||
      typeof response.session_id !== "string" ||
      !response.session_id
    ) {
      throw new Error("Voice backend failed to create a session.");
    }

    const sessionId = response.session_id;
    const { data: activated, error: activationError } = await supabase.rpc(
      "activate_interview_session",
      {
        p_interview_id: interviewId,
        p_reservation_id: reservationId,
        p_session_id: sessionId,
      },
    );

    if (activationError || !activated) {
      if (activationError) {
        console.error("[INTERVIEW_SESSION_ACTIVATION_ERROR]:", activationError);
      }
      throw new Error(
        "The interview session reservation expired. Please try again.",
      );
    }
    activatedSessionId = sessionId;

    const { data: interviewSession, error: sessionInsertError } = await supabase
      .from("interview_sessions")
      .insert({
        interview_id: interviewId,
        voice_session_id: sessionId,
        turns: [],
      })
      .select("id")
      .single();

    if (sessionInsertError || !interviewSession) {
      throw sessionInsertError ?? new Error("Failed to create interview session.");
    }

    return Response.json({
      wsUrl: `${process.env.NEXT_PUBLIC_VOICE_WS_URL}/ws/interview?session_id=${sessionId}`,
      sessionId,
      interviewSessionId: interviewSession.id,
    });
  } catch (error) {
    const { error: releaseError } = await supabase.rpc(
      "release_interview_session",
      {
        p_interview_id: interviewId,
        p_session_id: activatedSessionId ?? reservationId,
      },
    );
    if (releaseError) {
      console.error(
        "[INTERVIEW_SESSION_RESERVATION_RELEASE_ERROR]:",
        releaseError,
      );
    }

    console.error("[INTERVIEW_SESSION_START_ERROR]:", error);
    return NextResponse.json(
      { error: "Failed to create a voice session. Please try again." },
      { status: 502 },
    );
  }
}
