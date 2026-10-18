"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProgress } from "react-transition-progress";
import { User } from "@supabase/supabase-js";
import BookmarkJobSearch from "./BookmarkJobSearch";
import JobsPageDropdown from "./JobsPageDropdown";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import {
  agentPromptHref,
  MAX_PROMPT_CHARS,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";
import { activeTabFrom, type TalentListTab } from "@/utils/talent-list-tabs";
import ScrollMaskX from "./ScrollMaskX";

/**
 * What the jobs page's search box puts in the agent's message box when it's
 * sent empty. The user still sends it, and the agent asks for what it doesn't
 * know yet.
 */
export const JOB_SEARCH_PROMPT =
  "Help me find jobs that fit me. Use my profile and preferences, and ask me about anything you need, like the role, location or salary I'm after.";

/**
 * The jobs page's search box: opens the agent with what was typed, or with
 * JOB_SEARCH_PROMPT when it's empty.
 */
function AgentJobSearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <form
      role="search"
      aria-label="Find jobs with the assistant"
      className={
        "flex min-w-0 items-center gap-1 rounded-full border border-input bg-background py-0.5 pl-3 pr-0.5 transition-colors hover:border-foreground/20 focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-foreground/5 sm:w-72 " +
        (className ?? "")
      }
      onSubmit={(event) => {
        event.preventDefault();
        const prompt = query.trim() || JOB_SEARCH_PROMPT;
        // Logging in drops the query, so the prompt is also kept for after it.
        savePendingPrompt(prompt);
        router.push(agentPromptHref(prompt));
      }}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        aria-label="What jobs are you looking for?"
        value={query}
        maxLength={MAX_PROMPT_CHARS}
        placeholder="Describe your dream job..."
        className="h-8 min-w-0 flex-1 bg-transparent px-1 text-base placeholder:text-xs placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button
        type="submit"
        size="icon"
        variant={query.trim() ? "brand" : "ghost"}
        aria-label="Ask the assistant"
        className="h-8 w-8 shrink-0 rounded-full"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </form>
  );
}

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
              <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                {/* On a phone the search box takes the full row and the icon buttons go below it. */}
                {/* <AgentJobSearchBox className="w-full" /> */}
                <div className="flex items-center gap-2">
                  <BookmarkJobSearch user={user} />
                  <JobsPageDropdown user={user} />
                </div>
              </div>
            )}
          </div>
        ) : page === "jobs" ? (
          <div className="pt-6">
            <AgentJobSearchBox />
          </div>
        ) : (
          <div className="pt-6" />
        )}

        {children}
      </Tabs>
    </>
  );
}
