import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import { AskAgentAboutInterviewPlan } from "@/components/agent/recruiter/AskAgentAboutInterviews";
import SectionHeader from "@/components/SectionHeader";
import InterviewPlanEditor from "@/components/interviews/plan/InterviewPlanEditor";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { loadInterviewPlan } from "@/helpers/interviews/plan";
import { stagesForJob } from "@/helpers/pipeline/stages";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Interview plan",
};

/**
 * IVT-013: a job's interview plan. Seen with `scheduling.view` or
 * `interview_plans.manage` on the job, edited with `interview_plans.manage`.
 * With `agent.use`, the agent box sits under the header (IVT-086).
 */
export default async function JobInterviewPlanPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();
    const canEdit = can(company, "interview_plans.manage", job_id);
    if (!canEdit && !can(company, "scheduling.view", job_id)) notFound();

    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id, title")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const [plan, jobStages, membersRes, sourcesRes] = await Promise.all([
      loadInterviewPlan(supabase, job.id),
      // The job's own pipeline (JP-REQ-004).
      stagesForJob(company.id, job.id),
      supabase.rpc("list_interviewer_options"),
      // Other jobs whose plan the caller can see (RLS), for "Copy from another job".
      canEdit
        ? supabase.from("job_interview_plan_items").select("job_post_id, job_postings(title)").neq("job_post_id", job.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Rejected and Hired can't have interviews (IV-REQ-001).
    const stages = jobStages
      .filter((s) => !s.archived && s.kind !== "rejected" && s.kind !== "hired")
      .map((s) => ({ id: s.id, name: s.name }));
    const members = (membersRes.data ?? []).map((m) => ({ userId: m.user_id, name: m.name ?? "Teammate" }));
    const sources = new Map<string, string>();
    for (const row of (sourcesRes.data ?? []) as { job_post_id: string; job_postings: { title: string } | null }[]) {
      if (!sources.has(row.job_post_id)) sources.set(row.job_post_id, row.job_postings?.title ?? "Untitled job");
    }

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Interview plan"
          description={
            canEdit
              ? "The interviews each stage runs and what interviewers rate. Interviews already scheduled keep the plan they were scheduled with."
              : "The interviews each stage runs and what interviewers rate. Your role can't edit interview plans for this job."
          }
        />
        {can(company, "agent.use") && (
          <AskAgentAboutInterviewPlan
            job={{ id: job.id, title: job.title }}
            canEdit={canEdit}
            canViewInterviews={can(company, "scheduling.view", job.id)}
          />
        )}
        <InterviewPlanEditor
          jobPostId={job.id}
          stages={stages}
          plan={plan}
          members={members}
          canEdit={canEdit}
          copySources={[...sources].map(([jobId, title]) => ({ jobId, title }))}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
