import FilterComponent from "@/components/FilterComponent";
import { createClient } from "@/lib/supabase/server";
import { TabsContent } from "@/components/ui/tabs";
import { ICompanyInfo, IFormData, TAICredits } from "@/lib/types";
import { headers } from "next/headers";
import { ClientTabs } from "@/components/ClientTabs";
import CompaniesList from "./companiesList";
// import { commonIndustries } from "@/lib/utils";

// const uniqueIndustries = () => {
//   const industries = commonIndustries.map((each) => ({
//     industry: each,
//   }));
//   return industries;
// };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const searchParameters = await searchParams;

  const isAISearch = searchParameters
    ? searchParameters["sortBy"] === "relevance"
    : false;
  const activeTab =
    searchParameters && searchParameters["tab"]
      ? searchParameters["tab"]
      : "all";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isCompanyUser = false;
  let onboardingComplete = false;
  let ai_credits;
  let companyId;
  if (user) {
    const { data: jobSeekerData } = await supabase
      .from("user_info")
      .select("ai_credits, filled")
      .eq("user_id", user?.id)
      .single();
    const { data: companyData } = await supabase
      .from("company_info")
      .select("id, ai_credits, filled")
      .eq("user_id", user?.id)
      .single();

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
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  let initialCompanies: IFormData[] = [];
  // let uniqueLocations: { location: string }[] = [];
  // let uniqueCompanies: { company_name: string }[] = [];
  let totalCount: number = 0;
  const params = new URLSearchParams(
    searchParameters as Record<string, string>
  );
  try {
    params.set("tab", activeTab);
    params.set("limit", "20");
    if (params.get("sortBy") === "relevance") {
      params.set("limit", "100");
    }
    const res = await fetch(`${url}/api/companies?${params.toString()}`, {
      cache: "force-cache",
      next: { revalidate: 3600, tags: ["companies-feed"] },
      headers: {
        Cookie: headersList.get("Cookie") || "",
      },
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.message);

    // const resFilters = await fetch(`${url}/api/companies/filters`, {
    //   cache: "force-cache",
    //   next: { revalidate: 3600 },
    //   headers: {
    //     Cookie: headersList.get("Cookie") || "",
    //   },
    // });

    // const filterData = await resFilters.json();

    // if (!resFilters.ok) throw new Error(filterData.message);

    // uniqueLocations = filterData.locations;
    // uniqueCompanies = filterData.companies;

    // --- AI Re-ranking Logic ---

    if (
      params.get("sortBy") === "relevance" &&
      user &&
      result.data &&
      result.data.length > 0 &&
      ai_credits >= TAICredits.AI_SEARCH_OR_ASK_AI
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
            companies: result.data.map((company: ICompanyInfo) => ({
              id: company.id,
              name: company.name,
              description: company.description,
              headquarters: company.headquarters,
              company_size: company.company_size,
              industry: company.industry,
            })),
          }),
        });

        const aiRerankResult = await aiRerankRes.json();

        if (aiRerankRes.ok && aiRerankResult.rerankedCompanies) {
          const rerankedIds = aiRerankResult.rerankedCompanies;
          const filteredOutIds = aiRerankResult.filteredOutJobs || [];
          const companyMap = new Map(
            result.data.map((company: ICompanyInfo) => [company.id, company])
          );
          const reorderedCompanies = rerankedIds
            .map((id: string) => companyMap.get(id))
            .filter(
              (company: ICompanyInfo) =>
                company !== undefined && !filteredOutIds.includes(company.id)
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
      result.data &&
      result.data.length > 0 &&
      ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI
    ) {
      const companiesMap = new Map(
        result.data.map((company: ICompanyInfo) => [company.id, company])
      );
      const reorderedCompanies = result.matchedCompanyIds
        .map((id: string) => companiesMap.get(id))
        .filter((company: ICompanyInfo) => company !== undefined);
      initialCompanies = reorderedCompanies || [];
      totalCount = reorderedCompanies.length || 0;
    } else {
      initialCompanies = result.data || [];
      totalCount = result.count || 0;
    }
  } catch {
    // console.error("Failed to fetch jobs:", error);
  }
  // const listOfUniqueIndustries = uniqueIndustries();

  return (
    <div>
      <div className="flex items-start px-4 lg:px-20 xl:px-40 2xl:px-80 py-5 h-full gap-5">
        <div className="hidden md:block w-1/3 px-2 sticky top-0 z-10 max-h-[calc(100vh-1.5rem)] overflow-y-auto">
          <FilterComponent
            // uniqueLocations={uniqueLocations}
            // uniqueCompanies={uniqueCompanies}
            // uniqueIndustries={listOfUniqueIndustries}
            currentPage="companies"
            onboardingComplete={onboardingComplete}
          />
        </div>
        <div className="w-full md:w-2/3 ">
          <ClientTabs
            user={user}
            isCompanyUser={isCompanyUser}
            isAISearch={isAISearch}
            page="companies"
          >
            {
              <TabsContent value="all">
                <CompaniesList
                  isCompanyUser={isCompanyUser}
                  user={user}
                  // uniqueLocations={uniqueLocations}
                  // uniqueCompanies={uniqueCompanies}
                  // uniqueIndustries={listOfUniqueIndustries}
                  companyId={companyId}
                  onboardingComplete={onboardingComplete}
                  initialCompanies={initialCompanies}
                  totalCount={totalCount}
                />
              </TabsContent>
            }
            {user && !isCompanyUser && !isAISearch && (
              <TabsContent value="saved">
                <CompaniesList
                  isCompanyUser={isCompanyUser}
                  user={user}
                  // uniqueLocations={uniqueLocations}
                  // uniqueCompanies={uniqueCompanies}
                  // uniqueIndustries={listOfUniqueIndustries}
                  companyId={companyId}
                  onboardingComplete={onboardingComplete}
                  initialCompanies={initialCompanies}
                  totalCount={totalCount}
                />
              </TabsContent>
            )}
          </ClientTabs>
        </div>
      </div>
    </div>
  );
}
