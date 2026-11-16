import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import ActivityTimeline from "@/components/pipeline/ActivityTimeline";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { can } from "@/helpers/companies/permissions";
import type { CandidateRating } from "@/helpers/pipeline/ratings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Activity",
};

/** An application's Activity section: its event timeline. */
export default async function ApplicationActivityPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, application, company, jobId } = frame;

    // RLS: only the company's members can read its stages and events.
    // Archived stages are kept for the timeline's names.
    const companyId = application.job_postings?.company_id;
    const [{ data: events }, { data: stages }, { data: scorecards }] = await Promise.all([
      supabase
        .from("application_events")
        .select("*")
        .eq("application_id", application_id)
        .order("created_at", { ascending: false })
        .limit(200),
      companyId
        ? supabase
            .from("pipeline_stages")
            .select("id, name, kind, archived")
            .eq("company_id", companyId)
            .order("position", { ascending: true })
        : Promise.resolve({ data: null }),
      // IV-REQ-042: a submitted scorecard's recommendation, only where blind
      // review lets the reader see it (the RPC decides).
      jobId && can(company, "scheduling.view", jobId)
        ? supabase.rpc("list_interview_scorecards", { p_application_id: application_id })
        : Promise.resolve({ data: null }),
    ]);
    const scorecardOveralls: Record<string, CandidateRating> = {};
    for (const s of scorecards ?? []) {
      if (s.scorecard_id && s.content_visible && s.status === "submitted" && s.overall) {
        scorecardOveralls[s.scorecard_id] = s.overall;
      }
    }

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader title="Activity" />
        <ActivityTimeline events={events ?? []} stages={stages ?? []} scorecardOveralls={scorecardOveralls} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
