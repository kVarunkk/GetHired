import { reportError } from "@/helpers/posthog/report-error";
import FilterComponent from "@/components/FilterComponent";
import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { TabsContent } from "@/components/ui/tabs";
import { TAICredits, TCompanyInfo } from "@/utils/types";
import { headers } from "next/headers";
import { ClientTabs } from "@/components/ClientTabs";
import JobsComponent from "@/components/JobsComponent";
import { getBaseUrl } from "@/utils/get-base-url";
import { buildCompaniesQuery } from "@/helpers/companies/companiesFilterQueryBuilder";

/** The first page of companies for the page's URL filters (`limit` is already set). */
async function loadCompanies(
  params: URLSearchParams,
  supabase: Awaited<ReturnType<typeof createClient>> | null,
  userId: string | undefined,
) {
  const sortBy = params.get("sortBy");
  const page = parseInt(params.get("page") || "1", 10);
  const limit = parseInt(params.get("limit") || "20", 10);

  let userEmbedding: string | null = null;
  if (sortBy === "relevance" && supabase && userId) {
    const { data } = await supabase.from("user_info").select("embedding_new").eq("user_id", userId).single();
    userEmbedding = data?.embedding_new ?? null;
  }

  return buildCompaniesQuery({
    industry: params.get("industry"),
    location: params.get("location"),
    name: params.get("name"),
    size: params.get("size"),
    start_index: (page - 1) * limit,
    end_index: page * limit - 1,
    sortBy: sortBy ?? undefined,
    sortOrder: params.get("sortOrder") as "asc" | "desc",
    isFavoriteTabActive: params.get("tab") === "saved",
    userEmbedding,
  });
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const searchParameters = await searchParams;
  const isAISearch = searchParameters?.sortBy === "relevance";
  const activeTab = searchParameters?.tab || "all";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isCompanyUser = false;
  let onboardingComplete = false;
  let ai_credits = 0;
  let companyId;
  if (user) {
    const { data: jobSeekerData } = await supabase
      .from("user_info")
      .select("ai_credits, filled")
      .eq("user_id", user?.id)
      .single();
    const companyData = await getMyCompany(supabase, user).catch(() => null);

    if (companyData) {
      isCompanyUser = true;
      companyId = companyData.id;
    }

    if (jobSeekerData) {
      onboardingComplete = jobSeekerData.filled;
      ai_credits = jobSeekerData.ai_credits;
    }
  }

  // --- Data Fetching ---
  const headersList = await headers();
  // const host = headersList.get("host");
  // const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  // const url = `${protocol}://${host}`;

  const url = await getBaseUrl();

  let initialCompanies: TCompanyInfo[] = [];

  let totalCount: number = 0;
  const params = new URLSearchParams(
    searchParameters as Record<string, string>,
  );
  const dynamicKey = params.toString();

  try {
    params.set("tab", activeTab);
    params.set("limit", "20");
    if (params.get("sortBy") === "relevance") {
      params.set("limit", "100");
    }
    // Queried here, not through `/api/companies`: a request to our own public
    // URL leaves the server and comes back through the CDN and middleware.
    const result = await loadCompanies(params, user ? supabase : null, user?.id);
    if (result.error) throw new Error(result.error);
    const companiesData: TCompanyInfo[] = result.data || [];
    const matchedIds: string[] = result.matchedCompanyIds || [];
    // --- AI Re-ranking Logic ---

    if (
      params.get("sortBy") === "relevance" &&
      user &&
      companiesData &&
      ai_credits >= TAICredits.AI_SEARCH_ASK_AI_RESUME
    ) {
      try {
        const aiRerankRes = await fetch(`${url}/api/ai-search/companies`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: headersList.get("Cookie") || "",
          },
          body: JSON.stringify({
            userId: user.id,
            companies: companiesData.map((company) => ({
              id: company.id,
              name: company.name,
              description: company.description,
              headquarters: company.headquarters,
              company_size: company.company_size,
              industry: company.industry,
            })),
          }),
        });

        const aiRerankResult: {
          rerankedCompanies: string[];
          filteredOutJobs?: string[];
        } = await aiRerankRes.json();

        if (aiRerankRes.ok && aiRerankResult.rerankedCompanies) {
          const rerankedIds = aiRerankResult.rerankedCompanies;
          const filteredOutIds = aiRerankResult.filteredOutJobs || [];
          const companyMap = new Map(
            companiesData.map((company) => [company.id, company]),
          );
          const reorderedCompanies = rerankedIds
            .map((id: string) => companyMap.get(id))
            .filter(
              (company): company is TCompanyInfo =>
                !!company && !filteredOutIds.includes(company.id),
            );
          initialCompanies = reorderedCompanies || [];
          totalCount = reorderedCompanies.length || 0;
        }
      } catch (e) {
        throw e;
      }
    } else if (
      params.get("sortBy") === "relevance" &&
      user &&
      companiesData &&
      ai_credits < TAICredits.AI_SEARCH_ASK_AI_RESUME
    ) {
      const companiesMap = new Map(
        companiesData.map((company) => [company.id, company]),
      );
      const reorderedCompanies = matchedIds
        .map((id: string) => companiesMap.get(id))
        .filter((company) => company !== undefined);
      initialCompanies = reorderedCompanies || [];
      totalCount = reorderedCompanies.length || 0;
    } else {
      initialCompanies = companiesData || [];
      totalCount = companiesData.length || 0;
    }
  } catch (error) {
    reportError("[companies] page failed", error);
  }

  return (
    // <div>
    <div className="flex items-start px-4  gap-5">
      <div className="hidden lg:block w-1/4 px-2 sticky top-0 z-10 max-h-[calc(100vh)] overflow-y-auto">
        <FilterComponent
          dynamicKey={dynamicKey}
          currentPage="companies"
          onboardingComplete={onboardingComplete}
        />
      </div>
      <div className="w-full lg:w-3/4 ">
        <ClientTabs
          user={user}
          isCompanyUser={isCompanyUser}
          isAISearch={isAISearch}
          page="companies"
        >
          {
            <TabsContent value="all">
              <JobsComponent
                dynamicKey={dynamicKey}
                initialJobs={initialCompanies || []}
                user={user}
                isCompanyUser={isCompanyUser}
                current_page={"companies"}
                companyId={companyId}
                isOnboardingComplete={onboardingComplete}
                isAllJobsTab={true}
                isAppliedJobsTabActive={false}
                totalCount={totalCount}
                error={null}
                initialCursor={null}
              />
            </TabsContent>
          }
          {user && !isCompanyUser && !isAISearch && (
            <TabsContent value="saved">
              <JobsComponent
                dynamicKey={dynamicKey}
                initialJobs={initialCompanies || []}
                user={user}
                isCompanyUser={isCompanyUser}
                current_page={"companies"}
                companyId={companyId}
                isOnboardingComplete={onboardingComplete}
                isAllJobsTab={false}
                isAppliedJobsTabActive={false}
                totalCount={totalCount}
                error={null}
                initialCursor={null}
              />
            </TabsContent>
          )}
        </ClientTabs>
      </div>
    </div>
    // </div>
  );
}
