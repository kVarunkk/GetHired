"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { forwardRef, type ComponentProps } from "react";
import { PostHogEvent } from "@/utils/types";

export type DashboardAction = { section: string; kind: string; action: string };

/** CD-REQ-040: a row's action was used. Section, kind and action only: no names or ids. */
export function trackDashboardAction(properties: DashboardAction) {
  posthog.capture(PostHogEvent.CompanyDashboardAction, properties);
}

/** A row's link action, counted when followed. Works under `Button asChild`. */
const TrackedLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link> & { track: DashboardAction }>(
  function TrackedLink({ track, onClick, ...props }, ref) {
    return (
      <Link
        {...props}
        ref={ref}
        onClick={(event) => {
          trackDashboardAction(track);
          onClick?.(event);
        }}
      />
    );
  },
);

export default TrackedLink;
