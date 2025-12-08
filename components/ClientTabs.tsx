"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProgress } from "react-transition-progress";
import { User } from "@supabase/supabase-js";
import BookmarkJobSearch from "./BookmarkJobSearch";
import JobsPageDropdown from "./JobsPageDropdown";
import { Loader2 } from "lucide-react";
import GlobalJobSearch from "./GlobalJobSearch";
import { featureData } from "@/lib/utils";
import DisplayPromotion from "./DisplayPromotionDialog";

export function ClientTabs({
  user,
  isCompanyUser,
  isAISearch,
  applicationStatusFilter,
  page,
  children,
  aiCredits,
}: {
  user: User | null;
  isCompanyUser: boolean;
  isAISearch: boolean;
  applicationStatusFilter?: string | false;
  page: "jobs" | "profiles" | "companies";
  children: React.ReactNode;
  aiCredits?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const startProgress = useProgress();
  const initialTab = searchParams.get("tab") || "all";
  const [activeTab, setActiveTab] = useState<string>();

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleTabChange = (newTab: "all" | "saved" | "applied") => {
    setActiveTab(newTab);
    startTransition(() => {
      startProgress();
      const newSearchParams = new URLSearchParams(searchParams.toString());
      if (newTab === "all") {
        newSearchParams.delete("tab");
      } else {
        newSearchParams.set("tab", newTab);
      }
      router.push(
        `/${
          page === "jobs"
            ? "jobs"
            : page === "companies"
              ? "companies"
              : "company/profiles"
        }?${newSearchParams.toString()}`
      );
    });
  };

  return (
    <>
      <Tabs value={activeTab}>
        <div className="flex items-center justify-between flex-wrap pt-4">
          {user && !isCompanyUser && !isAISearch && page === "jobs" && (
            <div className="flex items-center gap-2">
              <TabsList className="!my-0">
                {!applicationStatusFilter && (
                  <TabsTrigger
                    value="all"
                    className="p-0"
                    onClick={() => handleTabChange("all")}
                    disabled={isPending}
                  >
                    <span className="py-1 px-2">All Jobs</span>
                  </TabsTrigger>
                )}
                {!applicationStatusFilter && (
                  <TabsTrigger
                    value="saved"
                    className="p-0"
                    onClick={() => handleTabChange("saved")}
                    disabled={isPending}
                  >
                    <span className="py-1 px-2">Saved Jobs</span>
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="applied"
                  className="p-0"
                  onClick={() => handleTabChange("applied")}
                  disabled={isPending}
                >
                  <span className="py-1 px-2">Applied Jobs</span>
                </TabsTrigger>
              </TabsList>
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}

          {user && !isCompanyUser && !isAISearch && page === "companies" && (
            <div className="flex items-center gap-2">
              <TabsList className="!my-0">
                {
                  <TabsTrigger
                    value="all"
                    className="p-0"
                    onClick={() => handleTabChange("all")}
                    disabled={isPending}
                  >
                    <span className="py-1 px-2">All Companies</span>
                  </TabsTrigger>
                }
                {
                  <TabsTrigger
                    value="saved"
                    className="p-0"
                    onClick={() => handleTabChange("saved")}
                    disabled={isPending}
                  >
                    <span className="py-1 px-2">Saved Companies</span>
                  </TabsTrigger>
                }
              </TabsList>
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}

          {user && !isAISearch && page === "profiles" && (
            <div className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger
                  value="all"
                  className="p-0"
                  onClick={() => handleTabChange("all")}
                  disabled={isPending}
                >
                  <span className="py-1 px-2">All Profiles</span>
                </TabsTrigger>
                <TabsTrigger
                  value="saved"
                  className="p-0"
                  onClick={() => handleTabChange("saved")}
                  disabled={isPending}
                >
                  <span className="py-1 px-2">Saved Profiles</span>
                </TabsTrigger>
              </TabsList>
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}

          {page === "jobs" && user && !isCompanyUser && (
            <div className="flex items-center gap-2">
              <GlobalJobSearch aiCredits={aiCredits} />
              <BookmarkJobSearch user={user} />
              <JobsPageDropdown user={user} />
            </div>
          )}
        </div>

        {children}
      </Tabs>
      {user && featureData && (
        <DisplayPromotion currentUserId={user.id} featureData={featureData} />
      )}
    </>
  );
}
