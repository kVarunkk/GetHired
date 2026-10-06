import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import InterviewComponent from "@/components/InterviewComponent";

type SessionSummary = {
  id: string;
  started_at: string;
  status: string;
  analysisStatus: string | null;
};

export default async function InterviewIdPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const { interviewId } = await params;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("interviews")
      .select("*, all_jobs(job_name), resumes(name), interview_sessions(id, turns)")
      .eq("id", interviewId)
      .single();

    if (!data || error) {
      throw new Error("Interview not found");
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from("interview_sessions")
      .select("id, started_at, status")
      .eq("interview_id", interviewId)
      .order("started_at", { ascending: true });

    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions ?? []).map((session) => session.id);
    const { data: analyses, error: analysesError } = sessionIds.length
      ? await supabase
          .from("interview_analyses")
          .select("interview_session_id, status")
          .eq("perspective", "candidate")
          .in("interview_session_id", sessionIds)
      : { data: [], error: null };

    if (analysesError) throw analysesError;

    const analysisBySession = new Map(
      (analyses ?? []).map((analysis) => [
        analysis.interview_session_id,
        analysis.status,
      ]),
    );
    const sessionHistory: SessionSummary[] = (sessions ?? []).map((session) => ({
      ...session,
      analysisStatus: analysisBySession.get(session.id) ?? null,
    }));

    return (
      <InterviewComponent
        interviewId={interviewId}
        interview={data}
        sessionHistory={sessionHistory}
      />
    );
  } catch {
    return <ErrorComponent />;
  }
}
