import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import InterviewComponent from "@/components/InterviewComponent";

export default async function InterviewIdPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const { interviewId } = await params;
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("interviews")
      .select("*, all_jobs(job_name), resumes(name)")
      .eq("id", interviewId)
      .single();

    if (!data || error) {
      throw new Error("Interview not found");
    }

    return <InterviewComponent interviewId={interviewId} interview={data} />;
  } catch {
    return <ErrorComponent />;
  }
}
