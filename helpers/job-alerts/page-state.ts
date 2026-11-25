import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { alertName } from "./name";
import { alertFiltersFromSearchParams } from "./filters";
import { canonicalAlert } from "./canonical";
import type { JobAlertFeedProps } from "@/components/job-alerts/JobAlertSlot";

/**
 * What the jobs page tells the banner and the bell (JA-REQ-013): the search's
 * `filters_key` and, for a signed-in applicant, whether they already have an
 * alert for it and how many are active. One small select, always scoped to the
 * session user.
 */
export async function loadJobAlertFeedState({
  supabase,
  userId,
  isCompany,
  searchParams,
}: {
  supabase: SupabaseClient<Database>;
  userId: string | null;
  isCompany: boolean;
  searchParams: Record<string, string | undefined>;
}): Promise<JobAlertFeedProps> {
  const filters = alertFiltersFromSearchParams(searchParams);
  const none = { state: "none", id: null, frequency: "weekly" } as const;
  const base = {
    filtersKey: null,
    name: "",
    isLoggedIn: !!userId,
    isCompany,
    alert: none,
    activeCount: 0,
  } satisfies JobAlertFeedProps;
  if (!filters) return base;

  const { key } = await canonicalAlert(filters);
  const props: JobAlertFeedProps = { ...base, filtersKey: key, name: alertName(filters) };
  if (!userId || isCompany) return props;

  const { data, error } = await supabase
    .from("bookmarks")
    .select("id, filters_key, is_alert_on, frequency")
    .eq("user_id", userId)
    .not("filters_key", "is", null);
  if (error || !data) return props;

  const match = data.find((row) => row.filters_key === key);
  return {
    ...props,
    activeCount: data.filter((row) => row.is_alert_on).length,
    alert: match
      ? {
          state: match.is_alert_on ? "active" : "paused",
          id: match.id,
          frequency: match.frequency === "daily" ? "daily" : "weekly",
        }
      : none,
  };
}
