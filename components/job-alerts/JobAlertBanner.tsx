"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import posthog from "@/lib/posthog/client";
import { PostHogEvent } from "@/utils/types";
import { JOB_ALERT_COPY } from "@/helpers/job-alerts/alerts";
import {
  createAlertSignupHref,
  JOB_ALERTS_SETTINGS_PATH,
} from "@/helpers/job-alerts/paths";
import {
  bannerState,
  BANNER_ACTIVE_CAP,
  type BannerInput,
} from "./banner-state";
import { useLiveJobAlert } from "./useLiveJobAlert";
import { useAlertBannerDismissals } from "./useAlertBannerDismissals";
import {
  useJobAlertControls,
  type AlertFrequency,
  type AlertSnapshot,
} from "./useJobAlertControls";

export type JobAlertBannerProps = {
  /** The current search's query string. */
  search: string;
  /** Null when the search can't be an alert. */
  filtersKey: string | null;
  /** `alertName` of the search, e.g. "Frontend jobs in Pune". */
  name: string;
  isLoggedIn: boolean;
  isCompany: boolean;
  tab: string | null;
  sortBy: string | null;
  alert: AlertSnapshot;
  activeCount: number;
  /** `empty_state` is the zero-results variant (JA-REQ-016). */
  variant?: "feed" | "empty_state";
  /**
   * The viewer came back from sign-up with `createAlert=<frequency>` (JA-REQ-018):
   * the alert is created once, then `onAutoCreated` removes the param.
   */
  autoCreate?: AlertFrequency | null;
  onAutoCreated?: () => void;
};

/** JA-REQ-012: the card that offers an email alert for the search being viewed. */
export default function JobAlertBanner({
  search,
  filtersKey,
  name,
  isLoggedIn,
  isCompany,
  tab,
  sortBy,
  alert: serverAlert,
  activeCount: serverActiveCount,
  variant = "feed",
  autoCreate = null,
  onAutoCreated,
}: JobAlertBannerProps) {
  const { store, ready, dismiss } = useAlertBannerDismissals();
  const { alert, activeCount } = useLiveJobAlert({
    search,
    enabled: isLoggedIn && !isCompany && !!filtersKey,
    alert: serverAlert,
    activeCount: serverActiveCount,
  });
  const [frequency, setFrequency] = useState<AlertFrequency>("weekly");
  const controls = useJobAlertControls({
    search,
    initial: alert,
    source: variant === "empty_state" ? "empty_state" : "feed_banner",
  });
  const created = controls.created;

  // JA-REQ-018/019: consumed once, whoever the viewer turned out to be.
  const autoRan = useRef(false);
  const { create } = controls;
  useEffect(() => {
    if (!autoCreate || autoRan.current) return;
    autoRan.current = true;
    if (isLoggedIn && !isCompany && filtersKey && alert.state !== "active")
      create(autoCreate);
    onAutoCreated?.();
  }, [
    autoCreate,
    onAutoCreated,
    isLoggedIn,
    isCompany,
    filtersKey,
    alert.state,
    create,
  ]);

  const input: BannerInput = {
    isCompany,
    filtersKey,
    tab,
    sortBy,
    alertState: controls.snapshot.state,
    activeCount,
    // The empty state is the highest-intent moment, so an earlier dismissal doesn't hide it.
    dismissed:
      variant === "empty_state"
        ? { keys: [], times: [], quietUntil: null }
        : store,
    now: Date.now(),
    created,
  };
  const state =
    ready || variant === "empty_state" ? bannerState(input) : "hidden";

  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (state !== "offer" && state !== "resume" && state !== "at_cap") return;
    if (!filtersKey || shownFor.current === filtersKey) return;
    shownFor.current = filtersKey;
    posthog.capture(PostHogEvent.JobAlertBannerShown, { state, variant });
  }, [state, filtersKey, variant]);

  if (state === "hidden" || state === "already_on") return null;

  const onDismiss = () => {
    if (!filtersKey) return;
    dismiss(filtersKey);
    posthog.capture(PostHogEvent.JobAlertBannerDismissed, { state, variant });
  };

  const manage = (
    <Button asChild variant="outline" size="sm">
      <Link href={JOB_ALERTS_SETTINGS_PATH}>Manage alerts</Link>
    </Button>
  );

  if (state === "created") {
    const { frequency: f } = controls.snapshot;
    return (
      <Card>
        <Copy
          title={`Alert on for ${name}`}
          body={`We'll email you ${f === "daily" ? "every morning" : "every Monday"} when new jobs match. You can pause it any time.`}
        />
        {manage}
      </Card>
    );
  }

  if (state === "at_cap") {
    return (
      <Card>
        <Copy
          title={`You have ${BANNER_ACTIVE_CAP} active alerts. Pause one to add this search.`}
        />
        {manage}
        <DismissButton onClick={onDismiss} />
      </Card>
    );
  }

  const title =
    variant === "empty_state"
      ? `No ${name} right now. We'll email you when one is posted.`
      : state === "resume"
        ? `Your alert for ${name} is paused`
        : `Get new ${name} by email`;
  const body =
    variant === "empty_state" || state === "resume"
      ? undefined
      : "We'll only email when something new matches.";

  const frequencyPicker = (
    <Select
      value={frequency}
      onValueChange={(v) => setFrequency(v as AlertFrequency)}
    >
      <SelectTrigger className="h-8 w-[110px]" aria-label="Alert frequency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="weekly">Weekly</SelectItem>
        <SelectItem value="daily">Daily</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Card>
      <Copy title={title} body={body} error={controls.error} />
      <div className="flex shrink-0 items-center gap-2">
        {frequencyPicker}
        {isLoggedIn ? (
          <Button
            variant="brand"
            size="sm"
            disabled={controls.pending}
            onClick={() =>
              state === "resume"
                ? controls.resume(frequency)
                : controls.create(frequency)
            }
          >
            {state === "resume" ? "Resume alert" : "Create alert"}
          </Button>
        ) : (
          <Button variant="brand" size="sm" asChild>
            <Link
              href={createAlertSignupHref(search, frequency)}
              onClick={() =>
                posthog.capture(PostHogEvent.JobAlertSignupStarted, {
                  frequency,
                  variant,
                })
              }
            >
              Create alert
            </Link>
          </Button>
        )}
        {variant === "feed" && <DismissButton onClick={onDismiss} />}
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Job alert"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      {children}
    </div>
  );
}

function Copy({
  title,
  body,
  error,
}: {
  title: string;
  body?: string;
  error?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <BellRing
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {body && <p className="text-sm text-muted-foreground">{body}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error || JOB_ALERT_COPY.failed}
          </p>
        )}
      </div>
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Dismiss"
      onClick={onClick}
    >
      <X className="h-4 w-4" />
    </Button>
  );
}
