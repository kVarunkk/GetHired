"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProgress } from "react-transition-progress";
import { User } from "@supabase/supabase-js";
import BookmarkJobSearch from "./BookmarkJobSearch";
import JobsPageDropdown from "./JobsPageDropdown";
import { Loader2 } from "lucide-react";
import { activeTabFrom, type TalentListTab } from "@/utils/talent-list-tabs";
import ScrollMaskX from "./ScrollMaskX";

export function ClientTabs({
  user,
  isCompanyUser,
  isAISearch,
  applicationStatusFilter,
  page,
  talentLists = [],
  children,
}: {
  user: User | null;
  isCompanyUser: boolean;
  isAISearch: boolean;
  applicationStatusFilter?: string | false;
  page: "jobs" | "profiles" | "companies";
  /** The company's talent lists, shown as tabs after Saved (profiles page). */
  talentLists?: TalentListTab[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const startProgress = useProgress();
  const [activeTab, setActiveTab] = useOptimistic(
    // On the profiles page, `tab` can also be a talent list's slug.
    page === "profiles"
      ? activeTabFrom(searchParams, talentLists)
      : searchParams.get("tab") || "all",
    (_, newTab: string) => newTab,
  );

  const handleTabChange = (newTab: string) => {
    startTransition(() => {
      setActiveTab(newTab);
      startProgress();
      const newSearchParams = new URLSearchParams(searchParams.toString());
      if (newTab === "all") {
        newSearchParams.delete("tab");
      } else {
        newSearchParams.set("tab", newTab);
      }
      // Each profiles tab (All, Saved, a list) is its own result set: start
      // from its first page.
      if (page === "profiles") newSearchParams.delete("cursor");
      router.push(
        `/${
          page === "jobs"
            ? "jobs"
            : page === "companies"
              ? "companies"
              : "company/profiles"
        }?${newSearchParams.toString()}`,
      );
    });
  };

  return (
    <>
      <Tabs value={activeTab}>
        {user ? (
          <div className="flex items-center justify-between flex-wrap gap-4 py-6">
            {!isCompanyUser && !isAISearch && page === "jobs" && (
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <ScrollMaskX revealSelector='[role="tab"][data-state="active"]'>
                  <TabsList className="!my-0">
                    {!applicationStatusFilter && (
                      <TabsTrigger
                        value="all"
                        className="p-0"
                        onClick={() => handleTabChange("all")}
                      >
                        <span className="py-1 px-2">
                          All<span className="max-[400px]:hidden"> Jobs</span>
                        </span>
                      </TabsTrigger>
                    )}
                    {!applicationStatusFilter && (
                      <TabsTrigger
                        value="saved"
                        className="p-0"
                        onClick={() => handleTabChange("saved")}
                      >
                        <span className="py-1 px-2">
                          Saved<span className="max-[400px]:hidden"> Jobs</span>
                        </span>
                      </TabsTrigger>
                    )}
                    <TabsTrigger
                      value="applied"
                      className="p-0"
                      onClick={() => handleTabChange("applied")}
                    >
                      <span className="py-1 px-2">
                        Applied<span className="max-[400px]:hidden"> Jobs</span>
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </ScrollMaskX>
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            )}

            {!isCompanyUser && !isAISearch && page === "companies" && (
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <ScrollMaskX revealSelector='[role="tab"][data-state="active"]'>
                  <TabsList className="!my-0">
                    {
                      <TabsTrigger
                        value="all"
                        className="p-0"
                        onClick={() => handleTabChange("all")}
                      >
                        <span className="py-1 px-2">
                          All
                          <span className="max-[400px]:hidden"> Companies</span>
                        </span>
                      </TabsTrigger>
                    }
                    {
                      <TabsTrigger
                        value="saved"
                        className="p-0"
                        onClick={() => handleTabChange("saved")}
                      >
                        <span className="py-1 px-2">
                          Saved
                          <span className="max-[400px]:hidden"> Companies</span>
                        </span>
                      </TabsTrigger>
                    }
                  </TabsList>
                </ScrollMaskX>
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            )}

            {!isAISearch && page === "profiles" && (
              <div className="flex min-w-0 max-w-full items-center gap-2">
                {/* Lists can outgrow the row: it scrolls sideways, fading at the edges with more tabs. */}
                <ScrollMaskX revealSelector='[role="tab"][data-state="active"]'>
                  <TabsList className="!my-0">
                    <TabsTrigger
                      value="all"
                      className="p-0"
                      onClick={() => handleTabChange("all")}
                    >
                      <span className="py-1 px-2">
                        All<span className="max-[400px]:hidden"> Profiles</span>
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="saved"
                      className="p-0"
                      onClick={() => handleTabChange("saved")}
                    >
                      <span className="py-1 px-2">
                        Saved
                        <span className="max-[400px]:hidden"> Profiles</span>
                      </span>
                    </TabsTrigger>
                    {talentLists.map((list) => (
                      <TabsTrigger
                        key={list.id}
                        value={list.slug}
                        className="p-0"
                        onClick={() => handleTabChange(list.slug)}
                      >
                        <span className="py-1 px-2">{list.name}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </ScrollMaskX>
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            )}

            {page === "jobs" && !isCompanyUser && (
              <div className="flex items-center gap-2">
                <BookmarkJobSearch user={user} />
                <JobsPageDropdown user={user} />
              </div>
            )}
          </div>
        ) : (
          <div className="pt-6" />
        )}

        {children}
      </Tabs>
    </>
  );
}
