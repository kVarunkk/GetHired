import { notFound, unstable_rethrow } from "next/navigation";
import ErrorComponent from "@/components/Error";
import OutreachTable from "@/components/outreach/OutreachTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
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
    const status = (OUTREACH_STATUSES as readonly string[]).includes(params.status ?? "")
      ? (params.status as OutreachStatus)
      : null;
    const cursor = params.cursor ?? null;

    const [{ data: jobs }, page] = await Promise.all([
      supabase.from("job_postings").select("id, title").eq("company_id", company.id).order("created_at", { ascending: false }),
      listCompanyOutreach({ supabase, company }, { jobPostId, status, cursor }),
    ]);

    return (
      <div className="flex w-full flex-col gap-6 p-4 mb-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Outreach</h1>
            <p className="text-sm text-muted-foreground">
              Messages to candidates in the talent pool. They answer on GetHired.
            </p>
          </div>
          <div className="rounded-lg border px-4 py-2 text-right">
            <p className="text-xs font-medium text-muted-foreground">Reply rate</p>
            <p className="text-lg font-semibold" data-testid="reply-rate">
              {page.replyRate === null ? "—" : `${Math.round(page.replyRate * 100)}%`}
            </p>
          </div>
        </div>

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
