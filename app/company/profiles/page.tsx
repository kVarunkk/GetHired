import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TabsContent } from "@/components/ui/tabs";
import FilterComponent from "@/components/FilterComponent";
import { AllProfileWithRelations } from "@/utils/types";
import { headers } from "next/headers";
import { ClientTabs } from "@/components/ClientTabs";
import JobsComponent from "@/components/JobsComponent";

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?company=true");
  }

  const searchParameters = await searchParams;
  const isAISearch = searchParameters?.sortBy === "relevance";

  const { data: companyData } = await supabase
    .from("company_info")
    .select("id, filled, ai_credits")
    .eq("user_id", user?.id)
    .single();

  if (!companyData) {
    redirect("/get-started?company=true");
  }
  const onboarding_complete = companyData.filled;

  // --- Data Fetching ---
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  let initialProfiles: AllProfileWithRelations[] = [];
  let totalCount: number = 0;
  let initialCursor: string | null = null;
  let error: string | null = null;

  const params = new URLSearchParams(
    searchParameters as Record<string, string>,
  );
  const dynamicKey = params.toString();
  try {
    // params.set("limit", "20");
    if (params.get("sortBy") === "relevance") {
      params.set("limit", "100");
    }
    const res = await fetch(`${url}/api/profiles?${params.toString()}`, {
      cache: "force-cache",
      next: { revalidate: 3600, tags: ["profiles-feed"] },
      headers: {
        Cookie: headersList.get("Cookie") || "",
      },
    });
    const {
      data,
      count,
      nextCursor,
      error,
    }: {
      data?: AllProfileWithRelations[];
      count?: number;
      nextCursor?: string;
      error?: string;
    } = await res.json();

    if (!res.ok) throw new Error(error || "Failed to fetch profiles");

    initialProfiles = data || [];
    totalCount = count || 0;
    initialCursor = nextCursor || null;

    // --- AI Re-ranking Logic ---
    // if (
    //   params.get("sortBy") === "relevance" &&
    //   params.get("job_post") &&
    //   user &&
    //   onboarding_complete &&
    //   data &&
    //   data.length > 0 &&
    //   companyData.ai_credits >= TAICredits.AI_SEARCH_ASK_AI_RESUME
    // ) {
    //   try {
    //     const aiRerankRes = await fetch(`${url}/api/ai-search/profiles`, {
    //       method: "POST",
    //       headers: {
    //         "Content-Type": "application/json",
    //         Cookie: headersList.get("Cookie") || "",
    //       },
    //       body: JSON.stringify({
    //         userId: user.id,
    //         job_post_id: params.get("job_post"),
    //         companyId: companyData.id,
    //         profiles: data.map((profile) => ({
    //           user_id: profile.user_id,
    //           full_name: profile.full_name,
    //           desired_roles: profile.desired_roles,
    //           experience_years: profile.experience_years,
    //           preferred_locations: profile.preferred_locations,
    //           top_skills: profile.top_skills,
    //           work_style_preferences: profile.work_style_preferences,
    //         })),
    //       } satisfies AiSearchProfileBody),
    //     });

    //     const aiRerankResult: {
    //       rerankedProfiles: string[];
    //       filteredOutProfiles: string[];
    //     } = await aiRerankRes.json();

    //     if (aiRerankRes.ok && aiRerankResult.rerankedProfiles) {
    //       const rerankedIds = aiRerankResult.rerankedProfiles;
    //       const filteredOutIds = aiRerankResult.filteredOutProfiles || [];

    //       const profilesMap = new Map(
    //         data.map((profile) => [profile.user_id, profile]),
    //       );

    //       const reorderedProfiles = rerankedIds
    //         .map((user_id: string) => profilesMap.get(user_id))
    //         .filter(
    //           (profile): profile is AllProfileWithRelations =>
    //             profile !== undefined &&
    //             typeof profile.user_id === "string" &&
    //             !filteredOutIds.includes(profile.user_id),
    //         );
    //       initialProfiles = reorderedProfiles || [];
    //       totalCount = reorderedProfiles.length || 0;
    //     }
    //   } catch (e) {
    //     throw e;
    //   }
    // } else if (
    //   params.get("sortBy") === "relevance" &&
    //   params.get("job_post") &&
    //   user &&
    //   onboarding_complete &&
    //   matchedProfileIds &&
    //   data &&
    //   data.length > 0 &&
    //   companyData.ai_credits < TAICredits.AI_SEARCH_ASK_AI_RESUME
    // ) {
    //   const profilesMap = new Map(
    //     data.map((profile) => [profile.user_id, profile]),
    //   );
    //   const reorderedProfiles = matchedProfileIds
    //     .map((user_id: string) => profilesMap.get(user_id))
    //     .filter(
    //       (profile): profile is AllProfileWithRelations =>
    //         profile !== undefined && typeof profile.user_id === "string",
    //     );
    //   initialProfiles = reorderedProfiles || [];
    //   totalCount = reorderedProfiles.length || 0;
    // } else {
    //   initialProfiles = data || [];
    //   totalCount = count || 0;
    //   initialCursor = nextCursor || null;
    // }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="flex items-start px-4 h-full gap-5">
      <div className="hidden md:block w-1/4 px-2 sticky top-0 z-10 max-h-[calc(100vh)] overflow-y-auto">
        <FilterComponent
          key={dynamicKey}
          currentPage={"profiles"}
          onboardingComplete={onboarding_complete}
        />
      </div>
      <div className="w-full md:w-3/4">
        <ClientTabs
          user={user}
          isCompanyUser={true}
          isAISearch={isAISearch}
          page={"profiles"}
        >
          <TabsContent value="all">
            <JobsComponent
              key={dynamicKey}
              initialJobs={initialProfiles || []}
              user={user}
              isCompanyUser={true}
              current_page={"profiles"}
              companyId={companyData.id}
              isOnboardingComplete={onboarding_complete}
              isAllJobsTab={true}
              isAppliedJobsTabActive={false}
              totalCount={totalCount}
              initialCursor={initialCursor}
              error={error}
            />
          </TabsContent>
          {user && !isAISearch && (
            <TabsContent value="saved">
              <JobsComponent
                key={dynamicKey}
                initialJobs={initialProfiles || []}
                user={user}
                isCompanyUser={true}
                current_page={"profiles"}
                companyId={companyData.id}
                isOnboardingComplete={onboarding_complete}
                isAllJobsTab={false}
                isAppliedJobsTabActive={false}
                totalCount={totalCount}
                initialCursor={initialCursor}
                error={error}
              />
            </TabsContent>
          )}
        </ClientTabs>
      </div>
    </div>
  );
}
