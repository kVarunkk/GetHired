import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import AskAgentAboutQuestionSets from "@/components/agent/recruiter/AskAgentAboutQuestionSets";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import QuestionSetsTable from "@/components/jobs/QuestionSetsTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { loadQuestionSets } from "@/helpers/jobs/load-question-sets";
import { MAX_QUESTION_SETS, QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Settings → Question sets (AF-REQ-004): reusable application forms that
 * job posts apply as a copy. Every member with jobs.view sees them;
 * question_sets.manage creates, edits and deletes. The actions check again.
 */
export default async function QuestionSetsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "jobs.view")) return <Forbidden what="question sets" />;

    const sets = await loadQuestionSets(supabase, company.id);
    if (!sets) return <Error />;
    const canManage = can(company, "question_sets.manage");
    const atLimit = sets.length >= MAX_QUESTION_SETS;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Question sets"
          description={
            <>
              Reusable application questions. Apply a set when you create or edit a job; the job gets its own copy,
              so later edits here don&apos;t change it.
            </>
          }
          actions={
            canManage && (
              <Button asChild={!atLimit} variant="brand" disabled={atLimit} title={atLimit ? `You can keep up to ${MAX_QUESTION_SETS} question sets.` : undefined}>
                {atLimit ? (
                  <span>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New set
                  </span>
                ) : (
                  <Link href={`${QUESTION_SETS_PATH}/new`}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New set
                  </Link>
                )}
              </Button>
            )
          }
        />

        {can(company, "agent.use") && <AskAgentAboutQuestionSets canManage={canManage} />}

        {!canManage && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Your role can apply these sets to jobs but can&apos;t create or change them.
          </p>
        )}

        <QuestionSetsTable
          canManage={canManage}
          sets={sets.map((set) => ({
            id: set.id,
            name: set.name,
            questionCount: set.form.questions.filter((q) => !q.archived).length,
            updatedAt: set.updatedAt,
          }))}
        />
        {canManage && (
          <p className="text-xs text-muted-foreground">
            {sets.length} of {MAX_QUESTION_SETS} sets used.
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
