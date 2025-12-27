"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProgress } from "react-transition-progress";
import { User } from "@supabase/supabase-js";
import BookmarkJobSearch from "./BookmarkJobSearch";
import JobsPageDropdown from "./JobsPageDropdown";
import { Loader2, Search } from "lucide-react";
import GlobalJobSearch from "./GlobalJobSearch";
import { Button } from "./ui/button";
import Link from "next/link";

export function ClientTabs({
  user,
  isCompanyUser,
  isAISearch,
  applicationStatusFilter,
  page,
  children,
}: {
  user: User | null;
  isCompanyUser: boolean;
  isAISearch: boolean;
  applicationStatusFilter?: string | false;
  page: "jobs" | "profiles" | "companies";
  children: React.ReactNode;
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
        {user ? (
          <div className="flex items-center justify-between flex-wrap gap-4 py-6">
            {!isCompanyUser && !isAISearch && page === "jobs" && (
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

            {!isCompanyUser && !isAISearch && page === "companies" && (
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

            {!isAISearch && page === "profiles" && (
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

            {page === "jobs" && !isCompanyUser && (
              <div className="flex items-center gap-2">
                <GlobalJobSearch />
                <BookmarkJobSearch user={user} />
                <JobsPageDropdown user={user} />
              </div>
            )}
          </div>
        ) : page === "jobs" ? (
          <div>
            <Button
              title="AI Search"
              variant="link"
              asChild
              aria-label="Open global job search"
              className="rounded-full text-xs bg-secondary text-muted-foreground  !no-underline hover:text-primary transition-colors"
            >
              <Link href={"/auth/sign-up?returnTo=/jobs"}>
                <Search className="h-5 w-5" />
                Search Jobs with AI...
              </Link>
            </Button>
          </div>
        ) : (
          ""
        )}

        {children}
      </Tabs>
    </>
  );
}
