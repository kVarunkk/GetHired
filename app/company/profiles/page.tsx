import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TabsContent } from "@/components/ui/tabs";
import FilterComponent from "@/components/FilterComponent";
import { ICompanyInfo, IFormData, TAICredits } from "@/lib/types";
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
  const searchParameters = await searchParams;
  const isAISearch = searchParameters
    ? searchParameters["sortBy"] === "relevance"
    : false;

  const { data: companyDataData }: { data: ICompanyInfo | null } =
    await supabase
      .from("company_info")
      .select("id, filled, ai_credits")
      .eq("user_id", user?.id)
      .single();

  if (!companyDataData) {
    redirect("/get-started?company=true");
  }
  const onboarding_complete = companyDataData.filled;
  const companyData: ICompanyInfo = companyDataData;

  // --- Data Fetching ---
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  let initialProfiles: IFormData[] = [];
  let totalCount: number = 0;
  const params = new URLSearchParams(
    searchParameters as Record<string, string>
  );

  try {
    params.set("limit", "20");
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
    const result = await res.json();

    if (!res.ok) throw new Error(result.message);

    // --- AI Re-ranking Logic ---
    if (
      params.get("sortBy") === "relevance" &&
      params.get("job_post") &&
      user &&
      onboarding_complete &&
      result.data &&
      result.data.length > 0 &&
      companyData.ai_credits >= TAICredits.AI_SEARCH_OR_ASK_AI
    ) {
      try {
        const aiRerankRes = await fetch(`${url}/api/ai-search/profiles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: headersList.get("Cookie") || "",
          },
          body: JSON.stringify({
            userId: user.id,
            job_post_id: params.get("job_post"),
            companyId: companyData.id,
            profiles: result.data.map((profile: IFormData) => ({
              user_id: profile.user_id,
              full_name: profile.full_name,
              desired_roles: profile.desired_roles,
              experience_years: profile.experience_years,
              preferred_locations: profile.preferred_locations,
              top_skills: profile.top_skills,
              work_style_preferences: profile.work_style_preferences,
            })),
          }),
        });

        const aiRerankResult: {
          rerankedProfiles: string[];
          filteredOutProfiles: string[];
        } = await aiRerankRes.json();

        if (aiRerankRes.ok && aiRerankResult.rerankedProfiles) {
          const rerankedIds = aiRerankResult.rerankedProfiles;
          const filteredOutIds = aiRerankResult.filteredOutProfiles || [];

          const profilesMap: Map<string, IFormData> = new Map(
            result.data.map((profile: IFormData) => [profile.user_id, profile])
          );

          const reorderedProfiles = rerankedIds
            .map((user_id: string) => profilesMap.get(user_id))
            .filter(
              (profile): profile is IFormData =>
                profile !== undefined &&
                typeof profile.user_id === "string" &&
                !filteredOutIds.includes(profile.user_id)
            );
          initialProfiles = reorderedProfiles || [];
          totalCount = reorderedProfiles.length || 0;
        }
      } catch (e) {
        throw e;
      }
    } else if (
      params.get("sortBy") === "relevance" &&
      params.get("job_post") &&
      user &&
      onboarding_complete &&
      result.matchedProfileIds &&
      result.data &&
      result.data.length > 0 &&
      companyData.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI
    ) {
      const profilesMap: Map<string, IFormData> = new Map(
        result.data.map((profile: IFormData) => [profile.user_id, profile])
      );
      const reorderedProfiles = result.matchedProfileIds
        .map((user_id: string) => profilesMap.get(user_id))
        .filter(
          (profile: IFormData) =>
            profile !== undefined && typeof profile.user_id === "string"
        );
      initialProfiles = reorderedProfiles || [];
      totalCount = reorderedProfiles.length || 0;
    } else {
      initialProfiles = result.data || [];
      totalCount = result.count || 0;
    }
  } catch {
    // console.error("Failed to fetch profiles:", error);
  }

  return (
    <div className="flex items-start px-4 h-full gap-5">
      <div className="hidden md:block w-1/4 px-2 sticky top-0 z-10 max-h-[calc(100vh)] overflow-y-auto">
        <FilterComponent
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
              initialJobs={initialProfiles || []}
              user={user}
              isCompanyUser={true}
              current_page={"profiles"}
              companyId={companyData.id}
              isOnboardingComplete={onboarding_complete}
              isAllJobsTab={true}
              isAppliedJobsTabActive={false}
              totalCount={totalCount}
            />
            {/* <ProfilesList
              user={user}
              companyData={companyData}
              initialProfiles={initialProfiles}
              onboardingComplete={onboarding_complete}
              totalCount={totalCount}
            /> */}
          </TabsContent>
          {user && !isAISearch && (
            <TabsContent value="saved">
              <JobsComponent
                initialJobs={initialProfiles || []}
                user={user}
                isCompanyUser={true}
                current_page={"profiles"}
                companyId={companyData.id}
                isOnboardingComplete={onboarding_complete}
                isAllJobsTab={false}
                isAppliedJobsTabActive={false}
                totalCount={totalCount}
              />
              {/* <ProfilesList
                user={user}
                companyData={companyData}
                initialProfiles={initialProfiles}
                onboardingComplete={onboarding_complete}
                totalCount={totalCount}
              /> */}
            </TabsContent>
          )}
        </ClientTabs>
      </div>
    </div>
  );
}
