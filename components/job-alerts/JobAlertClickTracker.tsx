"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "@/lib/posthog/client";
import { PostHogEvent } from "@/utils/types";
import { JOB_ALERT_REF } from "@/helpers/job-alerts/paths";

/**
 * JA-REQ-037: captures `job_alert_clicked` when a visitor arrives from an alert
 * email (`ref=job_alert&aid=<id>`), once per load. It renders nothing, and
 * `ref` is not a distribution tag, so `application source_detail` is untouched.
 */
export default function JobAlertClickTracker({ page }: { page: "jobs" | "job" }) {
  const searchParams = useSearchParams();
  const captured = useRef(false);
  const ref = searchParams.get("ref");
  const alertId = searchParams.get("aid");

  useEffect(() => {
    if (captured.current || ref !== JOB_ALERT_REF) return;
    captured.current = true;
    posthog.capture(PostHogEvent.JobAlertClicked, { alert_id: alertId, page });
  }, [ref, alertId, page]);

  return null;
}
