import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { loadCompanyApplications } from "@/helpers/applications/company-list";
import { parseApplicationListParams } from "@/helpers/applications/list-params";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import CompanyApplicationsTable from "@/components/applications/CompanyApplicationsTable";
import { AskAgentAboutApplicants } from "@/components/agent/recruiter/AskAgentOnMainPages";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications",
  description:
    "Every application to your job posts.",
};

/**
 * Every application to the company's job posts, 25 at a time, filtered,
 * sorted and paged by the server from the URL (QF-REQ-021).
 */
export default async function CompanyApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const companyInfo = await getMyCompany(supabase, user);

    if (!companyInfo) {
      throw new Error("Company profile not found");
    }

    const params = parseApplicationListParams(await searchParams);
    const list = await loadCompanyApplications({ supabase, company: companyInfo }, params);
    if (!list.ok) throw new Error(list.error);

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Applications"
          description="Every application to your job posts."
        />
        {can(companyInfo, "agent.use") && (
          <AskAgentAboutApplicants
            canView={canAny(companyInfo, "applicants.view")}
            canScreen={canAny(companyInfo, "applicants.screen")}
            canMove={canAny(companyInfo, "pipeline.move")}
          />
        )}
        <CompanyApplicationsTable list={list} params={{ ...params, page: list.page }} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
