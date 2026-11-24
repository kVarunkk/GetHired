"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutMyJobs } from "@/components/agent/AskAgentOnApplicantPages";
import { addJobPath, type MyJobsTab, type MyJobsView as View } from "@/helpers/tracker/paths";
import type { SavedJobItem, TrackerItem } from "@/helpers/tracker/types";
import type { AllJobWithRelations } from "@/utils/types";
import ApplicationsBoard from "./ApplicationsBoard";
import ApplicationsList from "./ApplicationsList";
import KeywordSearch from "./KeywordSearch";
import SavedJobs from "./SavedJobs";

/**
 * My Jobs (AT-REQ-013, AT-REQ-027): Applications | Saved tabs with their
 * counts, and on Applications a Board | List toggle. Tab and view live in the
 * URL, and the keyword search is the only filter.
 */
export default function MyJobsView({
  tab,
  view,
  q,
  applications,
  saved,
  boardJobs,
  matchedIds,
}: {
  tab: MyJobsTab;
  view: View;
  q: string | null;
  applications: TrackerItem[];
  saved: SavedJobItem[];
  boardJobs: AllJobWithRelations[];
  matchedIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6 px-4 pb-16 pt-4">
      <PageHeader
        title="My Jobs"
        description="Everything you applied to and saved, from GetHired and anywhere else."
        actions={
          <Button asChild variant="brand">
            <Link href={addJobPath(tab === "saved" ? "saved" : "applied")}>
              <Plus className="mr-1 h-4 w-4" />
              Add job
            </Link>
          </Button>
        }
      />
      <AskAgentAboutMyJobs />

      <Tabs value={tab} onValueChange={(value) => setParam("tab", value === "saved" ? "saved" : null)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="applications">Applications ({applications.length})</TabsTrigger>
            <TabsTrigger value="saved">Saved ({saved.length})</TabsTrigger>
          </TabsList>
          {tab === "applications" && (
            <Tabs value={view} onValueChange={(value) => setParam("view", value === "list" ? "list" : null)}>
              <TabsList>
                <TabsTrigger value="board">Board</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </Tabs>

      {tab === "applications" ? (
        view === "board" ? (
          <div className="flex flex-col gap-4">
            <KeywordSearch />
            <ApplicationsBoard items={applications} q={q} />
          </div>
        ) : (
          <ApplicationsList items={applications} q={q} />
        )
      ) : (
        <SavedJobs items={saved} boardJobs={boardJobs} matchedIds={matchedIds} q={q} />
      )}
    </div>
  );
}
