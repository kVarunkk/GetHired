import CompanyOnboardingForm from "@/components/CompanyOnboardingForm";
import { OnboardingForm } from "@/components/OnboardingComponent";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <div>
      {company ? <CompanyOnboardingForm user={user} /> : <OnboardingForm />}
    </div>
  );
}
