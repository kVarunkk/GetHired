import CompanyOnboardingForm from "@/components/CompanyOnboardingForm";
import { OnboardingForm } from "@/components/OnboardingComponent";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/helpers/user/home-path";
import { loadClaimPrefill } from "@/helpers/candidates/claim-prefill";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Metadata } from "next";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { company } = await searchParams;
  return {
    title: company === "true" ? "Set Up Your Company" : "Complete Your Profile",
    robots: { index: false, follow: false },
  };
}

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

  // BIT-105: after a claim, prefill from the company's record. Only a claim
  // this user made loads anything; otherwise the form is as it always was.
  const claimToken = !company && user && typeof params.claim === "string" ? params.claim : null;
  const claimPrefill = claimToken ? await loadClaimPrefill(createServiceRoleClient(), claimToken, user!.id) : null;

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
        <OnboardingForm
          claimPrefill={claimPrefill && claimToken ? { ...claimPrefill, token: claimToken } : undefined}
          returnTo={claimPrefill ? safeReturnPath(params.returnTo) : null}
        />
      )}
    </div>
  );
}
