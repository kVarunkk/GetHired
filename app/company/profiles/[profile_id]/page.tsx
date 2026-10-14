import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import ProfileClientHydrator from "@/components/ProfileClientHydrator";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";

// CACHE 1: Core profile data, scoped strictly by profile_id. The cache is shared
// across companies, so callers MUST check company_can_view_candidate first.
const getCachedApplicantProfile = (profile_id: string) =>
  unstable_cache(
    async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("user_info")
        .select(`${RECRUITER_CANDIDATE_COLUMNS}, resumes(resume_path)` as const)
        .eq("user_id", profile_id)
        .eq("resumes.is_primary", true)
        .maybeSingle();

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
    if (!isUuid(profile_id)) notFound();

    const user = await getUserFromRequest();
    if (!user) {
      throw new Error("User not authenticated.");
    }

    const supabase = await createClient();
    const company = await getMyCompany(supabase, user);
    if (!company) {
      throw new Error("Logged-in user does not have a company profile.");
    }

    // RS-SEC-003: public candidates, or ones who applied to this company. Runs
    // outside the cache, and fails closed on an error.
    const { data: canView, error: canViewError } = await supabase.rpc(
      "company_can_view_candidate",
      { p_user_id: profile_id },
    );
    if (canViewError || canView !== true) notFound();

    const [profile, applications] = await Promise.all([
      getCachedApplicantProfile(profile_id),
      getCompanyScopedApplications(profile_id, company.id),
    ]);

    if (!profile) notFound();

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
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
