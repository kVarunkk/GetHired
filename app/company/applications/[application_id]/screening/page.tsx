import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import ScreeningCard from "@/components/matching/ScreeningCard";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { SCREENING_VIEW_COLUMNS, toScreeningView } from "@/helpers/matching/screening-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fit Screening",
};

/** An application's Fit screening section: the AI fit screening against the job. */
export default async function ApplicationScreeningPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame?.jobId) notFound();
    const { supabase, jobId } = frame;

    // RLS: only the job's company members can read it (MT-SEC-004).
    const [{ data: screeningRow }, { data: job }] = await Promise.all([
      supabase.from("application_screenings").select(SCREENING_VIEW_COLUMNS).eq("application_id", application_id).maybeSingle(),
      supabase.from("job_postings").select("questions").eq("id", jobId).maybeSingle(),
    ]);

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader title="Fit screening" description="How well the candidate fits the job, screened by AI." />
        <ScreeningCard
          applicationId={application_id}
          jobPostId={jobId}
          questions={job?.questions ?? []}
          screening={screeningRow ? toScreeningView(screeningRow) : null}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
