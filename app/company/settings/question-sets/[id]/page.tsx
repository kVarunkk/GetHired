import { notFound, unstable_rethrow } from "next/navigation";
import AskAgentAboutQuestionSets from "@/components/agent/recruiter/AskAgentAboutQuestionSets";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import QuestionSetEditor from "@/components/jobs/QuestionSetEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { QUESTION_SETS_PATH, toQuestionSet } from "@/helpers/jobs/question-sets";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Question Set",
};

export const dynamic = "force-dynamic";

/**
 * Settings → Question sets → one set (AF-REQ-004). Needs jobs.view;
 * read-only without question_sets.manage.
 */
export default async function QuestionSetPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "jobs.view")) return <Forbidden what="question sets" />;
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

    const { data, error } = await supabase
      .from("company_question_sets")
      .select("id, name, form, updated_at")
      .eq("id", id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    const set = data ? toQuestionSet(data) : null;
    if (!set) notFound();
    const readOnly = !can(company, "question_sets.manage");

    return (
      <div className="mb-20 flex w-full max-w-4xl flex-col gap-6">
        <SectionHeader
          backHref={QUESTION_SETS_PATH}
          backLabel="Back to question sets"
          title={set.name}
          description={readOnly && "Your role can view this set but can't change it."}
        />
        {can(company, "agent.use") && (
          <AskAgentAboutQuestionSets set={{ id: set.id, name: set.name }} canManage={!readOnly} />
        )}
        <QuestionSetEditor id={set.id} initialName={set.name} initialForm={set.form} readOnly={readOnly} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
