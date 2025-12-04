import FilterComponent from "@/components/FilterComponent";
import { createClient } from "@/lib/supabase/server";
import JobsList from "./JobsList";
import { TabsContent } from "@/components/ui/tabs";
import { IJob, JobListingSearchParams, TAICredits } from "@/lib/types";
import { headers } from "next/headers";
import { ClientTabs } from "@/components/ClientTabs";
import { Metadata } from "next";
import { featureData, getCutOffDate } from "@/lib/serverUtils";
import DisplayPromotion from "@/components/DisplayPromotionDialog";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<JobListingSearchParams>; // Removed Promise as searchParams is usually a direct object
}): Promise<Metadata> {
  // Access searchParams directly, assuming the Next.js App Router pattern
  const { jobTitleKeywords, location, jobType } = await searchParams;

  const baseTitle = "Find Your Next Job";
  let title = baseTitle;
  let description =
    "Explore thousands of high-quality job postings filtered by relevance, salary, and experience. Start your career search here.";
  const keywords = [
    "jobs",
    "career",
    "employment",
    "remote",
    "tech jobs",
    "hiring",
    "job search",
  ];

  const titleParts: string[] = [];

  // --- 1. Dynamic Title Construction ---

  // B. Job Type (e.g., "Remote", "Full-Time") - Placed first for prefixing
  if (jobType) {
    const typesArray = jobType
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (typesArray.length > 0) {
      titleParts.push(typesArray.join(" & "));
      keywords.push(...typesArray.map((t) => `${t} jobs`));
    }
  }

  // A. Job Title Keywords (e.g., "Software Engineer")
  if (jobTitleKeywords) {
    const keywordsArray = jobTitleKeywords
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywordsArray.length > 0) {
      titleParts.push(
        keywordsArray[0].charAt(0).toUpperCase() + keywordsArray[0].slice(1)
      );
      keywords.push(...keywordsArray);
    }
  }

  // C. Location (e.g., "in Bangalore")
  if (location) {
    const locationsArray = location
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (locationsArray.length > 0) {
      const locationString = locationsArray.join(", ");

      // If we have any keywords (Type or Title), use "in [Location]"
      if (titleParts.length > 0) {
        titleParts.push(`in ${locationString}`);
      } else {
        // If only location is present, use location name directly
        titleParts.push(locationString);
      }
      keywords.push(...locationsArray);
    }
  }

  // --- 2. Final Consolidation and Edge Case Handling ---

  if (titleParts.length > 0) {
    // Add "Jobs" keyword only ONCE at the very end if not already present
    // This fixes "Remote Jobs Jobs" issue.
    if (!titleParts.some((p) => p.toLowerCase().includes("jobs"))) {
      titleParts.push("Jobs");
    }

    // Join all parts (e.g., "Remote Software Engineer in Bangalore Jobs")
    const dynamicSearchTerm = titleParts.join(" ");

    // Final SEO Title: [Search Term] - GetHired
    title = `${dynamicSearchTerm}`;

    // Update description using the finalized search term
    description = `Search and apply for ${dynamicSearchTerm} roles. Filtered by location, salary, and company, we help you find the best career opportunities now.`;
  }

  // --- 3. Keyword Cleanup ---
  // Ensure the final keywords array is unique and joined
  const finalKeywords = Array.from(new Set(keywords)).join(", ");

  return {
    title: title,
    description: description,
    keywords: finalKeywords,
  };
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const searchParameters = await searchParams;
  const applicationStatusFilter = searchParameters
    ? searchParameters["applicationStatus"]
    : false;
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
  if (user) {
    try {
      const { data: jobSeekerData, error: jobSeekerDataError } = await supabase
        .from("user_info")
        .select("ai_credits, filled")
        .eq("user_id", user?.id)
        .single();

      if (jobSeekerDataError) {
        const { data: companyData } = await supabase
          .from("company_info")
          .select("id, ai_credits, filled")
          .eq("user_id", user?.id)
          .single();

        if (companyData) {
          isCompanyUser = true;
        }
      } else if (jobSeekerData) {
        onboardingComplete = jobSeekerData.filled;
        ai_credits = jobSeekerData.ai_credits;
      }
    } catch {}
  }

  // --- Data Fetching ---
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  let initialJobs: IJob[] = [];
  let uniqueCompanies: { company_name: string }[] = [];
  let totalCount: number = 0;
  const params = new URLSearchParams(
    searchParameters as Record<string, string>
  );

  try {
    params.set("tab", activeTab);
    params.set("limit", "20");
    if (params.get("sortBy") === "relevance") {
      const cutoffDate = getCutOffDate(30);
      params.set("limit", "100");
      params.set("createdAfter", cutoffDate);
    }

    const jobFetchPromise = fetch(`${url}/api/jobs?${params.toString()}`, {
      cache: "force-cache",
      next: { revalidate: 3600, tags: ["jobs-feed"] },
      headers: { Cookie: headersList.get("Cookie") || "" },
    });

    const filterFetchPromise = fetch(`${url}/api/jobs/filters`, {
      cache: "force-cache",
      next: { revalidate: 86400 }, // Filters can be cached much longer
      headers: { Cookie: headersList.get("Cookie") || "" },
    });

    const [jobsResponse, filtersResponse] = await Promise.all([
      jobFetchPromise,
      filterFetchPromise,
    ]);

    const result = await jobsResponse.json();
    if (!jobsResponse.ok) throw new Error(result.message);

    const filterData = await filtersResponse.json();
    uniqueCompanies = filtersResponse.ok ? filterData.companies : [];

    // --- AI Re-ranking Logic ---
    if (
      params.get("sortBy") === "relevance" &&
      user &&
      result.data &&
      result.data.length > 0
    ) {
      if (ai_credits >= TAICredits.AI_SMART_SEARCH_OR_ASK_AI) {
        try {
          const aiRerankRes = await fetch(`${url}/api/ai-search/jobs`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: headersList.get("Cookie") || "",
            },
            body: JSON.stringify({
              userId: user.id,
              jobs: result.data.map((job: IJob) => ({
                id: job.id,
                job_name: job.job_name,
                description: job.description,
                visa_requirement: job.visa_requirement,
                salary_range: job.salary_range,
                locations: job.locations,
                experience: job.experience,
              })),
            }),
          });

          const aiRerankResult = await aiRerankRes.json();

          if (aiRerankRes.ok && aiRerankResult.rerankedJobs) {
            const rerankedIds = aiRerankResult.rerankedJobs;
            const filteredOutIds = aiRerankResult.filteredOutJobs || [];
            const jobMap = new Map(
              result.data.map((job: IJob) => [job.id, job])
            );
            const reorderedJobs = rerankedIds
              .map((id: string) => jobMap.get(id))
              .filter(
                (job: IJob) =>
                  job !== undefined && !filteredOutIds.includes(job.id)
              );
            initialJobs = reorderedJobs || [];
            totalCount = reorderedJobs.length || 0;
          }
        } catch (e) {
          throw e;
        }
      } else if (
        result.matchedJobIds &&
        ai_credits < TAICredits.AI_SMART_SEARCH_OR_ASK_AI
      ) {
        const jobMap = new Map(result.data.map((job: IJob) => [job.id, job]));
        initialJobs =
          result.matchedJobIds
            .map((id: string) => jobMap.get(id))
            .filter((job: IJob) => job !== undefined) || [];
        totalCount = result.count || 0;
      }
    } else {
      initialJobs = result.data || [];
      totalCount = result.count || 0;
    }
  } catch {}

  return (
    <div>
      <div className="flex items-start px-4 lg:px-20 xl:px-40 2xl:px-80 py-5 h-full gap-5">
        <div className="hidden md:block w-1/3 px-2 sticky top-0 z-10 max-h-[calc(100vh-1.5rem)] overflow-y-auto">
          <FilterComponent
            uniqueCompanies={uniqueCompanies}
            onboardingComplete={onboardingComplete}
            currentPage="jobs"
          />
        </div>
        <div className="w-full md:w-2/3 ">
          <ClientTabs
            user={user}
            isCompanyUser={isCompanyUser}
            isAISearch={isAISearch}
            applicationStatusFilter={applicationStatusFilter}
            page="jobs"
            aiCredits={ai_credits}
          >
            {!applicationStatusFilter && (
              <TabsContent value="all">
                <JobsList
                  isCompanyUser={isCompanyUser}
                  user={user}
                  uniqueCompanies={uniqueCompanies}
                  onboardingComplete={onboardingComplete}
                  initialJobs={initialJobs}
                  totalCount={totalCount}
                />
              </TabsContent>
            )}
            {user &&
              !isCompanyUser &&
              !applicationStatusFilter &&
              !isAISearch && (
                <TabsContent value="saved">
                  <JobsList
                    isCompanyUser={isCompanyUser}
                    user={user}
                    uniqueCompanies={uniqueCompanies}
                    onboardingComplete={onboardingComplete}
                    initialJobs={initialJobs}
                    totalCount={totalCount}
                  />
                </TabsContent>
              )}
            {user && !isCompanyUser && !isAISearch && (
              <TabsContent value="applied">
                <JobsList
                  isCompanyUser={isCompanyUser}
                  user={user}
                  onboardingComplete={onboardingComplete}
                  uniqueCompanies={uniqueCompanies}
                  initialJobs={initialJobs}
                  totalCount={totalCount}
                />
              </TabsContent>
            )}
          </ClientTabs>
        </div>
      </div>
      {user && featureData && (
        <DisplayPromotion currentUserId={user.id} featureData={featureData} />
      )}
    </div>
  );
}
