"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import type { User } from "@supabase/supabase-js";
import { createClient } from "../supabase/client";

export default function PostHogIdentify({
  initialUser,
}: {
  initialUser: User | null;
}) {
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (initialUser && identifiedId.current !== initialUser.id) {
      posthog.identify(initialUser.id, {
        email: initialUser.email,
        user_type: initialUser.app_metadata?.type,
      });
      identifiedId.current = initialUser.id;
    }

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUser = session?.user ?? null;

      if (currentUser && identifiedId.current !== currentUser.id) {
        posthog.identify(currentUser.id, {
          email: currentUser.email,
          user_type: currentUser.app_metadata?.type,
        });
        identifiedId.current = currentUser.id;
      }

      if (event === "SIGNED_OUT") {
        posthog.reset();
        identifiedId.current = null;
      }
    });

    return () => subscription.unsubscribe();
  }, [initialUser]);

  return null;
}
