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
import { getCandidateMatches } from "@/helpers/matching/candidate-matches";
import ProfileMatches from "@/components/matching/ProfileMatches";
import FindSimilarCandidates from "@/components/agent/recruiter/FindSimilarCandidates";

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
  searchParams,
}: {
  params: Promise<{ profile_id: string }>;
  searchParams?: Promise<{ job_post?: string }>;
}) {
  try {
    const { profile_id } = await params;
    const jobPostParam = (await searchParams)?.job_post;
    const jobPostId = jobPostParam && isUuid(jobPostParam) ? jobPostParam : undefined;
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

    const [profile, applications, matches] = await Promise.all([
      getCachedApplicantProfile(profile_id),
      getCompanyScopedApplications(profile_id, company.id),
      getCandidateMatches(supabase, profile_id, company.id, jobPostId),
    ]);

    if (!profile) notFound();

    // With a job in context, show only that job's match.
    const shownMatches = jobPostId ? matches.filter((m) => m.jobPostId === jobPostId) : matches;

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
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/company/profiles"
            className="text-muted-foreground hover:text-primary transition-colors w-fit p-2 pl-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <FindSimilarCandidates candidateId={profile_id} />
        </div>

        <ProfileMatches
          candidateId={profile_id}
          matches={shownMatches}
          expandedJobPostId={jobPostId}
        />

        <ProfileClientHydrator applicantProfile={completeProfileData} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
