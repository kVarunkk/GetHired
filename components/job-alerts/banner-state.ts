/** Client-safe: which job-alert banner a viewer sees, and how dismissals are kept (JA-REQ-010–015). */

export const ALERT_BANNER_STORAGE_KEY = "gethired:alert-banner-dismissed";
export const MAX_DISMISSED_KEYS = 50;
export const DISMISSALS_FOR_QUIET = 3;
export const QUIET_WINDOW_MS = 30 * 24 * 3600_000;
/** The most active alerts a user can have (JA-REQ-015). */
export const BANNER_ACTIVE_CAP = 5;

export type AlertState = "none" | "active" | "paused";
export type BannerState =
  "hidden" | "offer" | "resume" | "already_on" | "at_cap" | "created";

export type DismissalStore = {
  /** Dismissed `filters_key`s, oldest first, at most 50. */
  keys: string[];
  /** When each recent dismissal happened (ms). */
  times: number[];
  /** No banner on any search until then (ms). */
  quietUntil: number | null;
};

export const EMPTY_DISMISSALS: DismissalStore = {
  keys: [],
  times: [],
  quietUntil: null,
};

export type BannerInput = {
  isCompany: boolean;
  /** Null when the search can't be an alert. */
  filtersKey: string | null;
  /** The `tab` param; null or "all" means the plain feed. */
  tab: string | null;
  sortBy: string | null;
  alertState: AlertState;
  activeCount: number;
  dismissed: DismissalStore;
  now: number;
  /** The viewer just created the alert from this banner. */
  created?: boolean;
};

export function bannerState(input: BannerInput): BannerState {
  const {
    isCompany,
    filtersKey,
    tab,
    sortBy,
    alertState,
    activeCount,
    dismissed,
    now,
  } = input;
  if (isCompany || !filtersKey) return "hidden";
  if (tab && tab !== "all") return "hidden";
  if (sortBy === "relevance") return "hidden";
  if (input.created) return "created";
  if (alertState === "active") return "already_on";
  if (dismissed.quietUntil !== null && dismissed.quietUntil > now)
    return "hidden";
  if (dismissed.keys.includes(filtersKey)) return "hidden";
  if (activeCount >= BANNER_ACTIVE_CAP) return "at_cap";
  return alertState === "paused" ? "resume" : "offer";
}

/** The store after one dismissal of `key`. */
export function recordDismissal(
  store: DismissalStore,
  key: string,
  now: number,
): DismissalStore {
  const keys = [...store.keys.filter((k) => k !== key), key].slice(
    -MAX_DISMISSED_KEYS,
  );
  const times = [...store.times, now].filter((t) => now - t < QUIET_WINDOW_MS);
  if (times.length >= DISMISSALS_FOR_QUIET) {
    return { keys, times: [], quietUntil: now + QUIET_WINDOW_MS };
  }
  return { keys, times, quietUntil: store.quietUntil };
}

/** Reads a stored value; anything unreadable is an empty store. */
export function parseDismissals(raw: string | null): DismissalStore {
  if (!raw) return EMPTY_DISMISSALS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_DISMISSALS;
    const v = value as Record<string, unknown>;
    const strings = (x: unknown) =>
      Array.isArray(x)
        ? x.filter((i): i is string => typeof i === "string")
        : [];
    const numbers = (x: unknown) =>
      Array.isArray(x) ? x.filter((i): i is number => Number.isFinite(i)) : [];
    return {
      keys: strings(v.keys).slice(-MAX_DISMISSED_KEYS),
      times: numbers(v.times),
      quietUntil:
        typeof v.quietUntil === "number" && Number.isFinite(v.quietUntil)
          ? v.quietUntil
          : null,
    };
  } catch {
    return EMPTY_DISMISSALS;
  }
}
