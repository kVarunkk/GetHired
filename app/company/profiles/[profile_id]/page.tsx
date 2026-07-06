import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import ProfileClientHydrator from "@/components/ProfileClientHydrator";

// CACHE 1: Core profile data, scoped strictly by profile_id
const getCachedApplicantProfile = (profile_id: string) =>
  unstable_cache(
    async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("user_info")
        .select(
          `
          full_name,
          user_id,
          linkedin_url,
          github_url,
          email,
          min_salary,
          max_salary,
          experience_years,
          work_style_preferences,
          company_size_preference,
          career_goals_long_term,
          career_goals_short_term,
          visa_sponsorship_required,
          preferred_locations,
          desired_roles,
          salary_currency,
          top_skills,
          resumes(resume_path)
        `,
        )
        .eq("user_id", profile_id)
        .eq("resumes.is_primary", true)
        .single();

      if (error) throw error;
      return data;
    },
    [`applicant-profile-${profile_id}`],
    {
      revalidate: 86400,
      tags: [`profile-${profile_id}`],
    },
  )();

// FETCH 2: Company-scoped applications (Secure, Not globally cached)
const getCompanyScopedApplications = async (
  profile_id: string,
  company_id: string,
) => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
      id,
      status,
      created_at,
      job_postings!inner (
        id,
        title,
        company_id
      )
    `,
    )
    .eq("applicant_user_id", profile_id)
    .eq("job_postings.company_id", company_id)
    .order("created_at", {
      ascending: false,
    });

  if (error) return [];
  return data;
};

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profile_id: string }>;
}) {
  try {
    const { profile_id } = await params;

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("User not authenticated.");
    }

    const { data: companyData, error: companyError } = await supabase
      .from("company_info")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (companyError || !companyData) {
      throw new Error("Logged-in user does not have a company profile.");
    }

    const [profile, applications] = await Promise.all([
      getCachedApplicantProfile(profile_id),
      getCompanyScopedApplications(profile_id, companyData.id),
    ]);

    const { data: signedUrlData } = await supabase.storage
      .from("resumes")
      .createSignedUrl(profile.resumes?.[0]?.resume_path || "", 3600);

    const signedUrl = signedUrlData?.signedUrl;

    const completeProfileData = {
      ...profile,
      signedUrl,
      applications,
    };

    return (
      <div className="flex flex-col gap-4 w-full p-4 mb-20">
        <Link
          href="/company/profiles"
          className="text-muted-foreground hover:text-primary transition-colors w-fit p-2 pl-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <ProfileClientHydrator applicantProfile={completeProfileData} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
