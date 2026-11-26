"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createJobAlertAction } from "@/app/actions/job-alerts/create-job-alert";
import { updateJobAlertAction } from "@/app/actions/job-alerts/update-job-alert";
import type { AlertState } from "./banner-state";
import { refreshLiveAlert } from "./useLiveJobAlert";

export type AlertFrequency = "daily" | "weekly";
export type AlertSource = "feed_banner" | "empty_state" | "settings";

/** What the server knows about this search's alert, kept in step with what the viewer just did. */
export type AlertSnapshot = {
  state: AlertState;
  id: string | null;
  frequency: AlertFrequency;
};

/**
 * The latest thing the viewer did for one search. The bell button and the
 * banner are in different parts of the page and each call the hook, so this is
 * how an alert created or paused in one shows up in the other.
 */
type Shared = { search: string; snapshot: AlertSnapshot } | null;
let shared: Shared = null;
const listeners = new Set<() => void>();
const publish = (next: Shared) => {
  shared = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const readShared = () => shared;

/**
 * What the viewer did only holds while the page that has the controls is up.
 * Once it's gone (to settings, say) the server is the truth again: an alert
 * paused there must not read as on when the viewer comes back.
 */
let mounted = 0;
const useForgetWhenUnmounted = () =>
  useEffect(() => {
    mounted++;
    return () => {
      if (--mounted === 0) publish(null);
    };
  }, []);

/** For tests: forget what was done on the page. */
export const resetSharedAlertState = () => publish(null);

/**
 * Create, resume and pause for one search (JA-REQ-020, JA-REQ-021), shared by
 * the banner and the button so both show the same state.
 */
export function useJobAlertControls({
  search,
  initial,
  source,
}: {
  search: string;
  initial: AlertSnapshot;
  source: AlertSource;
}) {
  useForgetWhenUnmounted();
  const [local, setLocal] = useState(initial);
  const latest = useSyncExternalStore(subscribe, readShared, readShared);
  const snapshot = latest?.search === search ? latest.snapshot : local;
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [pending, startTransition] = useTransition();

  // The banner and the button stay mounted when the filters change, so what
  // the viewer did for the previous search must not carry over: start again
  // from what the server says about this one. Keyed on the search, not on
  // `initial`, so the confirmation after a create isn't reset by the refresh.
  const [seenSearch, setSeenSearch] = useState(search);
  if (seenSearch !== search) {
    setSeenSearch(search);
    setLocal(initial);
    setError(null);
    setCreated(false);
  }

  // The server's answer can land after the search changed (navigating back from
  // the AI search renders the new URL with the old props first), so follow it
  // when it changes. Only `local` is touched: the "created" confirmation stays.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (
    seenInitial.state !== initial.state ||
    seenInitial.id !== initial.id ||
    seenInitial.frequency !== initial.frequency
  ) {
    setSeenInitial(initial);
    setLocal(initial);
  }

  // What was done for another search no longer applies.
  useEffect(() => {
    if (shared && shared.search !== search) publish(null);
  }, [search]);

  const commit = useCallback(
    (next: AlertSnapshot) => {
      setLocal(next);
      publish({ search, snapshot: next });
      void refreshLiveAlert(search);
    },
    [search],
  );

  const create = useCallback(
    (frequency: AlertFrequency) =>
      startTransition(async () => {
        setError(null);
        const result = await createJobAlertAction({
          search,
          frequency,
          source,
        });
        if (!result.ok) return setError(result.error);
        commit({
          state: "active",
          id: result.alert.id,
          frequency: result.alert.frequency,
        });
        setCreated(true);
      }),
    [search, source, commit],
  );

  const resume = useCallback(
    (frequency?: AlertFrequency) =>
      startTransition(async () => {
        setError(null);
        if (!snapshot.id) return create(frequency ?? snapshot.frequency);
        const result = await updateJobAlertAction({
          id: snapshot.id,
          on: true,
          ...(frequency ? { frequency } : {}),
        });
        if (!result.ok) return setError(result.error);
        commit({
          ...snapshot,
          state: "active",
          frequency: frequency ?? snapshot.frequency,
        });
        setCreated(true);
      }),
    [snapshot, create, commit],
  );

  const pause = useCallback(
    () =>
      startTransition(async () => {
        setError(null);
        if (!snapshot.id) return;
        const result = await updateJobAlertAction({
          id: snapshot.id,
          on: false,
        });
        if (!result.ok) return setError(result.error);
        commit({ ...snapshot, state: "paused" });
        setCreated(false);
      }),
    [snapshot, commit],
  );

  return { snapshot, error, created, pending, create, resume, pause };
}
