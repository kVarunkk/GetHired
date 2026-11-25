"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/responsive-select";
import posthog from "@/lib/posthog/client";
import { PostHogEvent } from "@/utils/types";
import {
  createAlertSignupHref,
  JOB_ALERTS_SETTINGS_PATH,
} from "@/helpers/job-alerts/paths";
import { BANNER_ACTIVE_CAP } from "./banner-state";
import { useLiveJobAlert } from "./useLiveJobAlert";
import {
  useJobAlertControls,
  type AlertFrequency,
  type AlertSnapshot,
} from "./useJobAlertControls";

export type JobAlertButtonProps = {
  search: string;
  /** Null when the search can't be an alert: nothing is rendered. */
  filtersKey: string | null;
  name: string;
  isLoggedIn: boolean;
  isCompany: boolean;
  alert: AlertSnapshot;
  activeCount: number;
};

/** JA-REQ-017: the bell next to the filters. It works for any alertable search, AI search included (JA-DEC-006). */
export default function JobAlertButton({
  search,
  filtersKey,
  name,
  isLoggedIn,
  isCompany,
  alert: serverAlert,
  activeCount: serverActiveCount,
}: JobAlertButtonProps) {
  const [frequency, setFrequency] = useState<AlertFrequency>("weekly");
  const { alert, activeCount } = useLiveJobAlert({
    search,
    enabled: isLoggedIn && !isCompany && !!filtersKey,
    alert: serverAlert,
    activeCount: serverActiveCount,
  });
  const controls = useJobAlertControls({
    search,
    initial: alert,
    source: "feed_banner",
  });

  if (isCompany || !filtersKey) return null;
  const { state } = controls.snapshot;
  const on = state === "active";
  const atCap = !on && activeCount >= BANNER_ACTIVE_CAP;

  return (
    <ResponsivePopover
      title={on ? name : `Get new ${name} by email`}
      showTitleOnDesktop
      className="w-72 space-y-3"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 whitespace-nowrap"
          title={on ? "Alert on" : "Get alerts for this search"}
        >
          {on ? (
            <BellRing className="h-4 w-4 text-primary" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {on ? "Alert on" : "Alert"}
        </Button>
      }
    >
        {controls.error && (
          <p role="alert" className="text-sm text-destructive">
            {controls.error}
          </p>
        )}
        {on ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={controls.pending}
              onClick={controls.pause}
            >
              Pause
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={JOB_ALERTS_SETTINGS_PATH}>Manage</Link>
            </Button>
          </div>
        ) : atCap ? (
          <>
            <p className="text-sm text-muted-foreground">
              You have {BANNER_ACTIVE_CAP} active alerts. Pause one to add this
              search.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={JOB_ALERTS_SETTINGS_PATH}>Manage alerts</Link>
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              title="Alert frequency"
              value={frequency}
              onValueChange={(v) => setFrequency(v as AlertFrequency)}
            >
              <SelectTrigger
                className="h-8 w-[110px]"
                aria-label="Alert frequency"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
            {isLoggedIn ? (
              <Button
                variant="brand"
                size="sm"
                disabled={controls.pending}
                onClick={() =>
                  state === "paused"
                    ? controls.resume(frequency)
                    : controls.create(frequency)
                }
              >
                {state === "paused" ? "Resume alert" : "Create alert"}
              </Button>
            ) : (
              <Button variant="brand" size="sm" asChild>
                <Link
                  href={createAlertSignupHref(search, frequency)}
                  onClick={() =>
                    posthog.capture(PostHogEvent.JobAlertSignupStarted, {
                      frequency,
                      variant: "button",
                    })
                  }
                >
                  Create alert
                </Link>
              </Button>
            )}
          </div>
        )}
    </ResponsivePopover>
  );
}
