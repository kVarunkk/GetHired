import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import InterviewReport from "@/components/interviews/InterviewReport";
import { loadApplicationInterview } from "@/helpers/applications/application-page";

/**
 * SIT-063: an application's AI interview section, for interviews.view on the
 * job. The actions are in the layout's header (interviews.manage).
 */
export default async function ApplicationInterviewPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const { interview } = await loadApplicationInterview(application_id);
    if (!interview) notFound();

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader title="AI interview" />
        <InterviewReport interview={interview} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
