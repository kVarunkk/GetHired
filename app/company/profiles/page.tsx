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
    const res = await fetch(`${url}/api/profiles?${params.toString()}`, {
      cache: isAISearch ? "no-cache" : "force-cache",
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
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="flex items-start px-4 h-full gap-5">
      <div className="hidden md:block w-1/4 px-2 sticky top-0 z-10 max-h-[calc(100vh)] overflow-y-auto">
        <FilterComponent
          dynamicKey={dynamicKey}
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
              dynamicKey={dynamicKey}
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
                dynamicKey={dynamicKey}
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
