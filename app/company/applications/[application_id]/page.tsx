import { notFound, unstable_rethrow } from "next/navigation";
import AskAgentAboutApplication from "@/components/agent/recruiter/AskAgentAboutApplication";
import ApplicationAnswers from "@/components/applications/ApplicationAnswers";
import KnockoutBadge from "@/components/applications/KnockoutBadge";
import Error from "@/components/Error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { answersView } from "@/helpers/applications/answers-view";
import { loadApplicationFrame, loadApplicationInterview } from "@/helpers/applications/application-page";
import { can } from "@/helpers/companies/permissions";

/** An application's main section: its answers. The layout shows the header. */
export default async function ApplicationPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, company, jobId } = frame;

    const [{ data: application, error }, interview] = await Promise.all([
      supabase
        .from("applications")
        .select(
          "id, applicant_user_id, job_post_id, answers, answers_v2, form_snapshot, application_knockouts(failed, reasons, action_taken), user_info(full_name), job_postings(title, questions)",
        )
        .eq("id", application_id)
        .maybeSingle(),
      loadApplicationInterview(application_id),
    ]);
    if (error) throw error;
    if (!application) notFound();

    return (
      <div className="mb-20 flex flex-col gap-6">
        {can(company, "agent.use") && (
          <AskAgentAboutApplication
            application={{
              id: application.id,
              candidateId: application.applicant_user_id,
              candidateName: application.user_info?.full_name ?? null,
              jobPostId: application.job_post_id,
              jobTitle: application.job_postings?.title ?? null,
            }}
            canView={can(company, "applicants.view", jobId)}
            canMatch={can(company, "matching.run", jobId)}
            canViewNotes={can(company, "notes.view", jobId)}
            canMove={can(company, "pipeline.move", jobId)}
            canSearch={can(company, "talent.view")}
            interview={
              interview.interview
                ? "report"
                : interview.canManage && interview.config?.enabled
                  ? "invite"
                  : null
            }
          />
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Application Answers
              <KnockoutBadge knockout={application.application_knockouts} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ApplicationAnswers answers={answersView(application, application.job_postings?.questions)} />
          </CardContent>
        </Card>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
