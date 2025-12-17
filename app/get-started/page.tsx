import CompanyOnboardingForm from "@/components/CompanyOnboardingForm";
import NavbarParent, { INavItem } from "@/components/NavbarParent";
import { OnboardingForm } from "@/components/OnboardingComponent";
import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

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

  const navItems: INavItem[] = !company
    ? [
        {
          id: uuidv4(),
          label: "Home",
          href: "/",
          type: "equals",
        },
        {
          id: uuidv4(),
          label: "Jobs",
          href: "/jobs",
          type: "startswith",
        },
        {
          id: uuidv4(),
          label: "Companies",
          href: "/companies",
          type: "startswith",
        },
        {
          id: uuidv4(),
          label: "Dashboard",
          href: "/dashboard",
          type: "startswith",
        },
      ]
    : [
        {
          id: uuidv4(),
          label: "Home",
          href: "/company",
          type: "equals",
        },
        {
          id: uuidv4(),
          label: "Job Posts",
          href: "/company/job-posts",
          type: "equals",
        },
        {
          id: uuidv4(),
          label: "Applicants",
          href: "/company/applicants",
          type: "equals",
        },
        {
          id: uuidv4(),
          label: "Profiles",
          href: "/company/profiles",
          type: "equals",
        },
      ];

  return (
    <div>
      <NavbarParent navItems={navItems} />
      {company ? <CompanyOnboardingForm user={user} /> : <OnboardingForm />}
    </div>
  );
}
