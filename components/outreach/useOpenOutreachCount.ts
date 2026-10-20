"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Open outreach waiting for an applicant's answer, for the navbar badge
 * (OR-TASK-004). RLS returns only the user's own rows. 0 for companies,
 * signed-out visitors and on any error.
 */
export function useOpenOutreachCount(user: User | null): number {
  const [count, setCount] = useState(0);
  const applicantId = user && user.app_metadata?.type !== "company" ? user.id : null;

  useEffect(() => {
    if (!applicantId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { count: open, error } = await createClient()
          .from("candidate_outreach")
          .select("id", { count: "exact", head: true })
          .eq("candidate_user_id", applicantId)
          .eq("status", "sent")
          .gt("expires_at", new Date().toISOString());
        if (!cancelled) setCount(error ? 0 : (open ?? 0));
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicantId]);

  return count;
}
