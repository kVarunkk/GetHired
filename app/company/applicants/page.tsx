import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import BackButton from "@/components/BackButton";
import ApplicantsTable from "@/components/ApplicantsTable";
import { IApplication } from "@/lib/types";

export default async function CompanyApplicantsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    // Fetch company info to get the company_id
    const { data: companyInfo, error: companyInfoError } = await supabase
      .from("company_info")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (companyInfoError || !companyInfo) {
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
        job_postings(
          id,
          title
        ),
        user_info(
          full_name
        )
      `
      )
      .eq("job_postings.company_id", companyInfo.id)
      .order("created_at", { ascending: false });

    if (applicantsError) {
      // console.error("Error fetching applicants:", applicantsError);
      throw applicantsError;
    }

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div>
          <BackButton />
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-medium ">Job Applicants</h1>
        </div>
        <ApplicantsTable
          data={(applicants as unknown as IApplication[]) || []}
        />
      </div>
    );
  } catch {
    // console.error("Error in CompanyApplicantsPage:", err);
    return <ErrorComponent />;
  }
}
