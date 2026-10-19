import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Search } from "lucide-react";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import OutreachTable from "@/components/outreach/OutreachTable";
import { AskAgentAboutOutreachList } from "@/components/agent/recruiter/AskAgentOnMainPages";
import { Button } from "@/components/ui/button";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { OUTREACH_STATUSES } from "@/helpers/outreach/config";
import { listCompanyOutreach } from "@/helpers/outreach/list";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { OutreachStatus } from "@/utils/types/outreach.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The company's outreach (OR-REQ-007): candidate, job, status, dates and the reply rate. */
export default async function CompanyOutreachPage({
  searchParams,
}: {
  searchParams?: Promise<{ job?: string; status?: string; cursor?: string }>;
}) {
  try {
    const params = (await searchParams) ?? {};
    const user = await getUserFromRequest();
    if (!user) notFound();
    const supabase = await createClient();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const jobPostId = params.job && UUID.test(params.job) ? params.job : null;
    const status = (OUTREACH_STATUSES as readonly string[]).includes(
      params.status ?? "",
    )
      ? (params.status as OutreachStatus)
      : null;
    const cursor = params.cursor ?? null;

    const [{ data: jobs }, page] = await Promise.all([
      supabase
        .from("job_postings")
        .select("id, title")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false }),
      listCompanyOutreach({ supabase, company }, { jobPostId, status, cursor }),
    ]);

    return (
      <div className="flex w-full flex-col gap-6 p-4 mb-20">
        <PageHeader
          title="Outreach"
          description="Messages to candidates in the talent pool. They answer on GetHired."
          actions={
            <>
              {/* Outreach starts from a candidate's profile, so the CTA goes there. */}
              {can(company, "talent.view") && (
                <Button asChild variant="brand">
                  <Link href="/company/profiles">
                    <Search className="h-4 w-4" />
                    Find candidates
                  </Link>
                </Button>
              )}
            </>
          }
        />

        {can(company, "agent.use") && canAny(company, "outreach.send") && (
          <AskAgentAboutOutreachList
            canMatch={canAny(company, "matching.run")}
          />
        )}

        <OutreachTable
          items={page.items}
          jobs={jobs ?? []}
          jobPostId={jobPostId}
          status={status}
          cursor={cursor}
          nextCursor={page.nextCursor}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
