import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import ApplicantsTable from "@/components/ApplicantsTable";
import { AskAgentAboutApplicants } from "@/components/agent/recruiter/AskAgentOnMainPages";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications",
  description:
    "Every application to your job posts.",
};

export default async function CompanyApplicationsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    // Fetch company info to get the company_id
    const companyInfo = await getMyCompany(supabase, user);

    if (!companyInfo) {
      throw new Error("Company profile not found");
    }

    // Fetch all applications for the company's job postings
    const { data: applicants, error: applicantsError } = await supabase
      .from("applications")
      .select(
        `
        id,
        created_at,
        status,
        resume_url,
        answers_v2,
        job_postings(
          id,
          title
        ),
        user_info(
          full_name
        ),
        application_screenings(
          status,
          fit_score,
          recommendation
        ),
        application_knockouts(
          failed,
          reasons,
          action_taken
        )
      `,
      )
      .eq("job_postings.company_id", companyInfo.id)
      .order("created_at", { ascending: false });

    if (applicantsError) {
      throw applicantsError;
    }

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
        <ApplicantsTable data={applicants || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
