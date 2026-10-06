import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InterviewAnalysisReport } from "@/components/InterviewAnalysisReport";
import { InterviewAnalysisSchema } from "@/helpers/interview/interview-analysis";

export default async function InterviewAnalysisPage({
  params,
}: {
  params: Promise<{ interviewId: string; sessionId: string }>;
}) {
  const { interviewId, sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) notFound();

  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, name")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .single();

  if (interviewError || !interview) notFound();

  const { data: session, error: sessionError } = await supabase
    .from("interview_sessions")
    .select("id, interview_id, started_at, ended_at, status, turns")
    .eq("id", sessionId)
    .eq("interview_id", interviewId)
    .single();

  if (sessionError || !session) notFound();

  const { data: analysis, error: analysisError } = await supabase
    .from("interview_analyses")
    .select("status, result")
    .eq("interview_session_id", sessionId)
    .eq("perspective", "candidate")
    .maybeSingle();

  if (analysisError) throw analysisError;

  const { data: sessions, error: sessionsError } = await supabase
    .from("interview_sessions")
    .select("id, started_at, status")
    .eq("interview_id", interviewId)
    .order("started_at", { ascending: true });

  if (sessionsError) throw sessionsError;

  const result = analysis?.status === "completed"
    ? InterviewAnalysisSchema.safeParse(analysis.result)
    : null;

  return (
    <InterviewAnalysisReport
      interviewId={interview.id}
      interviewName={interview.name || "AI Interview"}
      sessionId={session.id}
      sessionStartedAt={session.started_at}
      sessionEndedAt={session.ended_at}
      sessionStatus={session.status}
      transcript={normalizeTranscript(session.turns)}
      analysisStatus={analysis?.status ?? null}
      result={result?.success ? result.data : null}
      sessions={(sessions ?? []).map((item) => ({
        id: item.id,
        startedAt: item.started_at,
        status: item.status,
      }))}
    />
  );
}

type TranscriptTurn = {
  id: string;
  user?: string;
  assistant?: string;
};

function normalizeTranscript(turns: unknown): TranscriptTurn[] {
  if (!Array.isArray(turns)) return [];

  return turns.flatMap((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];

    const row = turn as Record<string, unknown>;
    const user = typeof row.user === "string" ? row.user : undefined;
    const assistant =
      typeof row.assistant === "string" ? row.assistant : undefined;

    if (!user?.trim() && !assistant?.trim()) return [];

    return [{
      id: typeof row.turn_id === "string" ? row.turn_id : `turn-${index}`,
      user,
      assistant,
    }];
  });
}
