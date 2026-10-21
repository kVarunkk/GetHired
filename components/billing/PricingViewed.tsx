"use client";

import { useEffect } from "react";
import posthog from "@/lib/posthog/client";
import { PostHogEvent } from "@/utils/types";

/** Captures billing_pricing_viewed once per visit to the pricing page. */
export default function PricingViewed() {
  useEffect(() => {
    posthog.capture(PostHogEvent.BillingPricingViewed);
  }, []);
  return null;
}
