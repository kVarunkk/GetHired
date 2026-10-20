import CompanyOnboardingForm from "@/components/CompanyOnboardingForm";
import { OnboardingForm } from "@/components/OnboardingComponent";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/helpers/user/home-path";

export default async function GetStartedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;
  const company = params.company === "true";

  // Through company_members, so every member sees the company's profile, not
  // only the owner (company_info.user_id).
  const myCompany = company && user ? await getMyCompany(supabase, user) : null;

  return (
    <div>
      {company ? (
        <CompanyOnboardingForm
          user={user}
          company={
            myCompany
              ? { id: myCompany.id, canEditProfile: can(myCompany, "company.profile") }
              : null
          }
          returnTo={safeReturnPath(params.returnTo)}
        />
      ) : (
        <OnboardingForm />
      )}
    </div>
  );
}
