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
import { parseStoredExplanation } from "@/helpers/matching/schemas";
import MatchScoreBadge from "@/components/matching/MatchScoreBadge";
import MatchExplanationCard from "@/components/matching/MatchExplanationCard";

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

// MT-REQ-004: the candidate's match for one of this company's jobs, or null.
const getJobMatch = async (
  profile_id: string,
  company_id: string,
  job_post_id: string,
) => {
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", job_post_id)
    .eq("company_id", company_id)
    .maybeSingle();
  if (!job) return null;

  const { data: match } = await supabase
    .from("job_relevant_profiles")
    .select("match_score, explanation, explanation_status")
    .eq("job_posting_id", job.id)
    .eq("user_id", profile_id)
    .maybeSingle();

  return {
    job,
    matchScore: match?.match_score ?? null,
    explanation:
      match?.explanation_status === "completed"
        ? parseStoredExplanation(match.explanation)
        : null,
  };
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
    const jobPostId = (await searchParams)?.job_post;
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

    const [profile, applications, jobMatch] = await Promise.all([
      getCachedApplicantProfile(profile_id),
      getCompanyScopedApplications(profile_id, company.id),
      jobPostId && isUuid(jobPostId)
        ? getJobMatch(profile_id, company.id, jobPostId)
        : null,
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

        {jobMatch && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <span>Match for {jobMatch.job.title}</span>
              <MatchScoreBadge score={jobMatch.matchScore} />
            </div>
            <MatchExplanationCard
              jobPostId={jobMatch.job.id}
              candidateId={profile_id}
              explanation={jobMatch.explanation}
            />
          </div>
        )}

        <ProfileClientHydrator applicantProfile={completeProfileData} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
