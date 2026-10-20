import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import ProfileClientHydrator from "@/components/ProfileClientHydrator";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import {
  DIRECTORY_CANDIDATE_COLUMNS,
  RECRUITER_CANDIDATE_COLUMNS,
} from "@/helpers/profiles/candidate-columns";
import { publicResumeContent } from "@/helpers/profiles/ai-rerank-profiles";
import { getCandidateMatches } from "@/helpers/matching/candidate-matches";
import { outreachStatusFor } from "@/helpers/outreach/list";
import ProfileMatches from "@/components/matching/ProfileMatches";
import AskAgentAboutCandidate from "@/components/agent/recruiter/AskAgentAboutCandidate";
import { can, canAny } from "@/helpers/companies/permissions";
import DirectoryProfile, { type DirectoryProfileData } from "@/components/outreach/DirectoryProfile";
import ReachOutButton from "@/components/outreach/ReachOutButton";
import type { AllProfileWithRelations } from "@/utils/types";
import type { ResumeSectionsPublic } from "@/utils/types/outreach.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

// CACHE 1: the directory profile (OR-REQ-010), identical for every company:
// directory columns and the scrubbed resume sections, never contact details
// or the resume file (difference 6). The cache is shared across companies, so
// callers MUST check company_can_view_candidate first.
const getCachedDirectoryProfile = (profile_id: string) =>
  unstable_cache(
    async (): Promise<DirectoryProfileData | null> => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("user_info")
        .select(
          `${DIRECTORY_CANDIDATE_COLUMNS}, resumes(is_primary, resume_public_sections(sections))` as const,
        )
        .eq("user_id", profile_id)
        .eq("resumes.is_primary", true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      const { resumes, ...profile } = data;
      const sections = publicResumeContent({ resumes } as AllProfileWithRelations).sections ?? [];
      return { ...profile, resume_sections: sections as ResumeSectionsPublic };
    },
    [`directory-profile-${profile_id}`],
    {
      revalidate: 86400,
      tags: [`profile-${profile_id}`],
    },
  )();

// FETCH 2: the full profile, with contact details and the resume path. Only
// after company_has_candidate_access; RLS client, never cached.
const getFullProfile = async (supabase: SupabaseClient<Database>, profile_id: string) => {
  const { data, error } = await supabase
    .from("user_info")
    .select(`${RECRUITER_CANDIDATE_COLUMNS}, resumes(resume_path)` as const)
    .eq("user_id", profile_id)
    .eq("resumes.is_primary", true)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// FETCH 3: Company-scoped applications (Secure, Not globally cached)
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

    // RS-SEC-003: public candidates (who haven't blocked this company), or ones
    // who applied to it. Runs outside the cache, and fails closed on an error.
    const { data: canView, error: canViewError } = await supabase.rpc(
      "company_can_view_candidate",
      { p_user_id: profile_id },
    );
    if (canViewError || canView !== true) notFound();

    // OR-SEC-001: contact details and the resume file only after the candidate
    // applied or answered Interested. Fails closed to the directory profile.
    const { data: access } = await supabase.rpc("company_has_candidate_access", {
      p_user_id: profile_id,
    });
    const hasAccess = access === true;

    // OR-REQ-020: one view per company, candidate and day. Never fails the page.
    after(async () => {
      try {
        await supabase.rpc("record_profile_view", { p_candidate: profile_id });
      } catch (err) {
        console.error("[profile] couldn't record the view", err);
      }
    });

    const [profile, applications, matches, badges] = await Promise.all([
      hasAccess ? getFullProfile(supabase, profile_id) : getCachedDirectoryProfile(profile_id),
      getCompanyScopedApplications(profile_id, company.id),
      getCandidateMatches(supabase, profile_id, company.id, jobPostId),
      outreachStatusFor({ supabase, company }, [profile_id]).catch(() => ({}) as Awaited<ReturnType<typeof outreachStatusFor>>),
    ]);

    if (!profile) notFound();

    // With a job in context, show only that job's match.
    const shownMatches = jobPostId ? matches.filter((m) => m.jobPostId === jobPostId) : matches;

    let body: React.ReactNode;
    if (hasAccess) {
      const full = profile as NonNullable<Awaited<ReturnType<typeof getFullProfile>>>;
      const { data: signedUrlData } = await supabase.storage
        .from("resumes")
        .createSignedUrl(full.resumes?.[0]?.resume_path || "", 3600);
      body = (
        <ProfileClientHydrator
          applicantProfile={{ ...full, signedUrl: signedUrlData?.signedUrl, applications }}
        />
      );
    } else {
      body = <DirectoryProfile profile={profile as DirectoryProfileData} />;
    }

    return (
      <div className="flex flex-col gap-6 w-full min-w-0 p-4 mb-20">
        <PageHeader
          backHref="/company/profiles"
          backLabel="Back to candidates"
          title={<span className="[overflow-wrap:anywhere]">{profile.full_name}</span>}
          description={!hasAccess && profile.desired_roles?.length ? profile.desired_roles.join(", ") : undefined}
          actions={
            <ReachOutButton
              candidateId={profile_id}
              candidateName={profile.full_name}
              status={badges[profile_id]?.status ?? null}
              outreachId={badges[profile_id]?.id ?? null}
              defaultJobPostId={jobPostId}
            />
          }
        />

        {can(company, "agent.use") && (
          <AskAgentAboutCandidate
            candidate={{ id: profile_id, name: profile.full_name }}
            canSearch={can(company, "talent.view")}
            canManageLists={can(company, "talent_lists.manage")}
            canSendOutreach={canAny(company, "outreach.send")}
          />
        )}

        <ProfileMatches
          candidateId={profile_id}
          matches={shownMatches}
          expandedJobPostId={jobPostId}
        />

        {body}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
