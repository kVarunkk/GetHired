import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import JobApprovalSetting from "@/components/jobs/JobApprovalSetting";
import Forbidden from "@/components/roles/Forbidden";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { OWNER_ONLY_MESSAGE, can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Job Settings",
};

export const dynamic = "force-dynamic";

/**
 * Settings → Jobs (JL-REQ-018): whether job posts need approval before they
 * open. Readable with jobs.view; only owners change it (D7), and the action
 * checks again.
 */
export default async function JobSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "jobs.view")) return <Forbidden what="job settings" />;

    const { data, error } = await supabase
      .from("company_info")
      .select("job_approval_required")
      .eq("id", company.id)
      .single();
    if (error) throw error;

    const readOnly = company.isOwner ? null : OWNER_ONLY_MESSAGE;
    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Approval"
          description="Ask for sign-off before a job post goes live for the first time."
        />
        <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-5">
          {readOnly && (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{readOnly}</p>
          )}
          <fieldset disabled={Boolean(readOnly)} title={readOnly ?? undefined} className="min-w-0 disabled:opacity-80">
            <JobApprovalSetting initial={data.job_approval_required} />
          </fieldset>
        </section>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
