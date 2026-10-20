/** Active job alerts per user. The DB trigger `bookmarks_alert_cap` enforces the same number. */
export const MAX_BOOKMARK_ALERTS = 5;

/** Relevance-sorted searches depend on the user's matches, so they can't become alerts. */
export function canAlertOnUrl(url: string | null): url is string {
  return !!url && !url.includes("sortBy=relevance");
}
