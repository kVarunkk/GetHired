import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import JobInterviewPanel from "@/components/interviews/JobInterviewPanel";
import AskAgentAboutInterview from "@/components/agent/recruiter/AskAgentAboutInterview";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { countUninvitedAboveThreshold, getInterviewFunnel } from "@/helpers/interview/screening/funnel";
import { createClient } from "@/lib/supabase/server";

/**
 * A job's AI interview (SIT-060/061): the funnel and the config, for
 * interviews.view on the job. Editing needs interviews.manage and jobs.edit,
 * like the action. A section of the job's layout.
 */
export default async function JobInterviewPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "interviews.view", job_id)) notFound();

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id, title")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const [config, funnel] = await Promise.all([
      getInterviewConfig(supabase, job.id),
      getInterviewFunnel(supabase, job.id),
    ]);
    const uninvitedAboveThreshold =
      config?.enabled && config.invite_rule === "fit_threshold" && config.fit_threshold !== null
        ? await countUninvitedAboveThreshold(supabase, job.id, config.fit_threshold)
        : 0;

    const canEdit = can(company, "interviews.manage", job.id) && can(company, "jobs.edit", job.id);

    // No bottom padding: the config's save bar sticks to the bottom edge.
    return (
      <div className="flex w-full flex-col gap-6">
        <SectionHeader
          title="AI interview"
          description="Screen applicants with a short AI voice interview before you talk to them."
          actions={
            config?.enabled ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>
          }
        />
        {can(company, "agent.use") && <AskAgentAboutInterview job={{ id: job.id, title: job.title }} canManage={canEdit} />}
        <JobInterviewPanel
          jobPostId={job.id}
          config={config}
          funnel={funnel}
          uninvitedAboveThreshold={uninvitedAboveThreshold}
          canEdit={canEdit}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
