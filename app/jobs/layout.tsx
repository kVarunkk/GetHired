import Error from "@/components/Error";
import NavbarParent, { INavItem } from "@/components/NavbarParent";
import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

export default async function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let isCompanyUser = false;
    try {
      const { data: companyData } = await supabase
        .from("company_info")
        .select("id")
        .eq("user_id", user?.id)
        .single();

      if (companyData) {
        isCompanyUser = true;
      }
    } catch {}

    const navItems: INavItem[] = !isCompanyUser
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
      <div className="h-screen ">
        <NavbarParent navItems={navItems} />
        {children}
      </div>
    );
  } catch {
    return <Error />;
  }
}
