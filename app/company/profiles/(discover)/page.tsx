import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { redirect } from "next/navigation";
import { TabsContent } from "@/components/ui/tabs";
import FilterComponent from "@/components/FilterComponent";
import { AllProfileWithRelations } from "@/utils/types";
import { ClientTabs } from "@/components/ClientTabs";
import PageHeader from "@/components/PageHeader";
import JobsComponent from "@/components/JobsComponent";
import {
  loadProfilesFeed,
  type ProfilesFeedBody,
} from "@/helpers/profiles/profiles-feed";
import { listTalentLists } from "@/helpers/pipeline/talent-lists";
import { can, canAny } from "@/helpers/companies/permissions";
import { AskAgentAboutProfiles } from "@/components/agent/recruiter/AskAgentOnMainPages";
import { activeTabFrom, CANDIDATES_TAB } from "@/utils/talent-list-tabs";
import { CANDIDATES_LIST_PATH } from "@/helpers/candidates/paths";
import { loadCandidatesTab, type CandidatesTab } from "@/helpers/candidates/candidates-tab";
import CompanyCandidatesTable from "@/components/candidates/CompanyCandidatesTable";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "People on GetHired's talent pool. Search, save them to lists and reach out.",
};

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
  const params = new URLSearchParams(
    searchParameters as Record<string, string>,
  );
  // "Your candidates" was a tab here before it got its own page.
  if (params.get("tab") === CANDIDATES_TAB) {
    params.delete("tab");
    const rest = params.toString();
    redirect(rest ? `${CANDIDATES_LIST_PATH}?${rest}` : CANDIDATES_LIST_PATH);
  }
  const dynamicKey = params.toString();
  const isAISearch = searchParameters?.sortBy === "relevance";

  const company = await getMyCompany(supabase, user);
  if (!company) {
    redirect("/get-started?company=true");
  }

  // Talent lists, shown as tabs after Saved (PL-TASK-051). Extra: a failure hides them.
  const talentListsLoad = listTalentLists({
    supabase,
    company,
  }).catch(() => []);

  // A list's company candidates sit under its GetHired members (BI-REQ-006),
  // for members who can see the pool. Extra: a failure hides them.
  const activeListLoad = talentListsLoad.then(async (lists) => {
    const activeList = lists.find(
      (list) => list.slug === activeTabFrom(params, lists),
    );
    const candidates =
      activeList && can(company, "talent.view") && !isAISearch
        ? await loadCandidatesTab(supabase, company, searchParameters, {
            listId: activeList.id,
          }).catch(() => null)
        : null;
    return { activeList, candidates };
  });

  // Loaded together: each of these is its own database round trips.
  const [{ data: companyData }, talentLists, { activeList, candidates }, feed] =
    await Promise.all([
      supabase
        .from("company_info")
        .select("id, filled")
        .eq("id", company.id)
        .single(),
      talentListsLoad,
      activeListLoad,
      loadProfilesFeed({ supabase, user, searchParams: params }).catch(
        (e: unknown): { status: number; body: ProfilesFeedBody } => ({
          status: 500,
          body: { error: e instanceof Error ? e.message : String(e) },
        }),
      ),
    ]);

  if (!companyData) {
    redirect("/get-started?company=true");
  }
  const onboarding_complete = companyData.filled;

  const error =
    feed.status === 200
      ? null
      : typeof feed.body.error === "string" && feed.body.error
        ? feed.body.error
        : "Failed to fetch profiles";
  const results: ProfilesFeedBody = error ? {} : feed.body;
  const initialProfiles: AllProfileWithRelations[] = results.data || [];
  const totalCount = results.count || 0;
  const initialCursor = results.nextCursor || null;
  const profilesPerSearch = results.profilesPerSearch ?? null;
  const hiddenCount = results.hiddenCount ?? 0;
  const upgradePlan = results.upgradePlan ?? null;

  return (
    <div className="flex items-start px-4 h-full gap-5">
      <div className="hidden lg:block w-1/4 px-2 sticky top-0 z-10 max-h-[calc(100vh)] overflow-y-auto">
        <FilterComponent
          dynamicKey={dynamicKey}
          currentPage={"profiles"}
          onboardingComplete={onboarding_complete}
        />
      </div>
      <div className="w-full lg:w-3/4">
        <div className="flex flex-col gap-6 pt-4">
          <PageHeader
            title="Discover"
            description="People on GetHired's talent pool. Search, save them to lists and reach out."
          />
          {can(company, "agent.use") && (
            <AskAgentAboutProfiles
              canSearch={can(company, "talent.view")}
              canMatch={canAny(company, "matching.run")}
              canManageLists={can(company, "talent_lists.manage")}
            />
          )}
        </div>
        <ClientTabs
          user={user}
          isCompanyUser={true}
          isAISearch={isAISearch}
          page={"profiles"}
          talentLists={talentLists}
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
              profilesPerSearch={profilesPerSearch}
              hiddenCount={hiddenCount}
              upgradePlan={upgradePlan}
            />
          </TabsContent>
          {user &&
            !isAISearch &&
            // Saved and each talent list get their own panel, like All, so the
            // tab you switch to keeps showing results while the new ones
            // load. Only the active panel renders.
            ["saved", ...talentLists.map((list) => list.slug)].map((tab) => (
              <TabsContent key={tab} value={tab}>
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
                  profilesPerSearch={profilesPerSearch}
                />
                {candidates &&
                  tab === activeList?.slug &&
                  (candidates.list.total > 0 ||
                    candidates.list.page > 1 ||
                    hasCandidateFilters(candidates)) && (
                    <section className="mt-8 flex flex-col gap-3">
                      <h2 className="text-lg font-semibold">
                        Your candidates in this list
                      </h2>
                      <CompanyCandidatesTable {...candidates} inList />
                    </section>
                  )}
              </TabsContent>
            ))}
        </ClientTabs>
      </div>
    </div>
  );
}

/** Whether the table is filtered, so an empty list still shows its toolbar. */
const hasCandidateFilters = ({ filters }: CandidatesTab) =>
  Boolean(
    filters.q ||
      filters.tag ||
      filters.batchId ||
      filters.inJob ||
      filters.loc ||
      filters.resume ||
      filters.email ||
      filters.addedDays ||
      filters.matchJob,
  );
