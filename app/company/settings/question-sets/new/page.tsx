import { notFound, unstable_rethrow } from "next/navigation";
import AskAgentAboutQuestionSets from "@/components/agent/recruiter/AskAgentAboutQuestionSets";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import Forbidden from "@/components/roles/Forbidden";
import QuestionSetEditor from "@/components/jobs/QuestionSetEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { emptyApplicationForm } from "@/helpers/jobs/application-form-schema";
import { QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Settings → Question sets → New (AF-REQ-004). Needs question_sets.manage. */
export default async function NewQuestionSetPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "question_sets.manage")) return <Forbidden what="the question set editor" />;

    return (
      <div className="mb-20 flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageHeader backHref={QUESTION_SETS_PATH} backLabel="Back to question sets" title="New question set" />
        {can(company, "agent.use") && <AskAgentAboutQuestionSets canManage />}
        <QuestionSetEditor initialForm={emptyApplicationForm()} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
