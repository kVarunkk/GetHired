"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ALERT_BANNER_STORAGE_KEY,
  EMPTY_DISMISSALS,
  parseDismissals,
  recordDismissal,
  type DismissalStore,
} from "./banner-state";

/**
 * The banner's dismissals, in `localStorage` (JA-REQ-014). Read after mount,
 * so the server render and the first client render match; a missing, corrupt
 * or blocked store reads as empty.
 */
export function useAlertBannerDismissals() {
  const [store, setStore] = useState<DismissalStore>(EMPTY_DISMISSALS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setStore(
        parseDismissals(window.localStorage.getItem(ALERT_BANNER_STORAGE_KEY)),
      );
    } catch {
      setStore(EMPTY_DISMISSALS);
    }
    setReady(true);
  }, []);

  const dismiss = useCallback((key: string) => {
    setStore((current) => {
      const next = recordDismissal(current, key, Date.now());
      try {
        window.localStorage.setItem(
          ALERT_BANNER_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Storage is blocked: the dismissal lasts for this page view.
      }
      return next;
    });
  }, []);

  return { store, ready, dismiss };
}
