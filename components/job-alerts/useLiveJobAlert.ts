"use client";

import useSWR, { mutate } from "swr";
import { getJobAlertStateAction } from "@/app/actions/job-alerts/get-job-alert-state";
import type { AlertSnapshot } from "./useJobAlertControls";

type Live = { alert: AlertSnapshot; activeCount: number };

export const liveAlertKey = (search: string) => ["job-alert-state", search] as const;

/** Re-reads this search's alert after the viewer changed it, so a later visit doesn't start from a stale copy. */
export const refreshLiveAlert = (search: string) => mutate(liveAlertKey(search));

/**
 * The page's alert state (JA-REQ-017) kept honest on the client. Going back to
 * the jobs page can restore a cached copy of it (e.g. after pausing the alert
 * in settings), so it is re-read on mount and when the tab regains focus. The
 * server's copy is what shows until the fresh one arrives.
 */
export function useLiveJobAlert({
  search,
  enabled,
  alert,
  activeCount,
}: {
  search: string;
  enabled: boolean;
  alert: AlertSnapshot;
  activeCount: number;
}): Live {
  const { data } = useSWR<Live | null>(
    enabled ? liveAlertKey(search) : null,
    () => getJobAlertStateAction({ search }),
    {
      fallbackData: { alert, activeCount },
      revalidateOnMount: true,
      revalidateOnFocus: true,
    },
  );
  return data ?? { alert, activeCount };
}
