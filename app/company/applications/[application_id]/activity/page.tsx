import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import ActivityTimeline from "@/components/pipeline/ActivityTimeline";
import { loadApplicationFrame } from "@/helpers/applications/application-page";

/** An application's Activity section: its event timeline. */
export default async function ApplicationActivityPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, application } = frame;

    // RLS: only the company's members can read its stages and events.
    // Archived stages are kept for the timeline's names.
    const companyId = application.job_postings?.company_id;
    const [{ data: events }, { data: stages }] = await Promise.all([
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
    ]);

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader title="Activity" />
        <ActivityTimeline events={events ?? []} stages={stages ?? []} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
