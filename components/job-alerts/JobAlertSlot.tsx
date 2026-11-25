"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CREATE_ALERT_PARAM } from "@/helpers/job-alerts/paths";
import JobAlertBanner, { type JobAlertBannerProps } from "./JobAlertBanner";
import type { AlertFrequency } from "./useJobAlertControls";

/** What the server page knows about the viewer's alerts for this search (JA-REQ-013). */
export type JobAlertFeedProps = Pick<
  JobAlertBannerProps,
  "filtersKey" | "name" | "isLoggedIn" | "isCompany" | "alert" | "activeCount"
>;

/** The search's query string without what isn't a filter. */
export function searchWithoutControls(searchParams: URLSearchParams) {
  const next = new URLSearchParams(searchParams.toString());
  for (const key of [CREATE_ALERT_PARAM, "ref", "aid", "tab"]) next.delete(key);
  return next.toString();
}

/**
 * Where `JobsComponent` puts the alert card (inline after the 5th job, or in
 * the empty state).
 */
export default function JobAlertSlot({
  placement,
  ...props
}: JobAlertFeedProps & { placement: "inline" | "empty" }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const createAlert = searchParams.get(CREATE_ALERT_PARAM);
  const autoCreate: AlertFrequency | null =
    createAlert === "daily" || createAlert === "weekly" ? createAlert : null;
  const dropParam = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete(CREATE_ALERT_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname]);

  const tab = searchParams.get("tab");
  const sortBy = searchParams.get("sortBy");

  return (
    <JobAlertBanner
      {...props}
      search={searchWithoutControls(searchParams)}
      tab={tab}
      sortBy={sortBy}
      variant={placement === "empty" ? "empty_state" : "feed"}
      autoCreate={autoCreate}
      onAutoCreated={dropParam}
    />
  );
}
