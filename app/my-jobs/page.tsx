import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MyJobsView from "@/components/tracker/MyJobsView";
import { createClient } from "@/lib/supabase/server";
import { listMyApplications } from "@/helpers/tracker/list-my-applications";
import { listMySavedJobs, loadSavedBoardJobs } from "@/helpers/tracker/list-my-saved";
import { parseMyJobsTab, parseMyJobsView } from "@/helpers/tracker/paths";

export const metadata: Metadata = {
  title: "My Jobs",
  description: "Everything you applied to and saved, in one place.",
  robots: { index: false, follow: false },
};

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = parseMyJobsTab(params.tab);
  const view = parseMyJobsView(params.view);
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim() : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const ctx = { supabase, user: { id: user.id } };

  // The counts on the tabs ignore the search, so both lists load whole.
  const [applications, saved] = await Promise.all([listMyApplications(ctx), listMySavedJobs(ctx)]);

  const favoriteIds = saved.filter((item) => item.kind === "favorite").map((item) => item.allJobsId);
  const { jobs, matchedIds } = tab === "saved" ? await loadSavedBoardJobs(ctx, favoriteIds) : { jobs: [], matchedIds: [] };

  return (
    <MyJobsView
      tab={tab}
      view={view}
      q={q}
      applications={applications}
      saved={saved}
      boardJobs={jobs}
      matchedIds={matchedIds}
    />
  );
}
