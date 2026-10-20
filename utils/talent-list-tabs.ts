// Talent lists as tabs on /company/profiles (PL-TASK-051): `?tab=<slug>`.
// Shared by the page (a server component), ClientTabs, the profiles API and
// the list helpers, so it can't live in a "use client" or server-only file.

export type TalentListTab = {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
};

/** The profiles page's own tabs. A list's slug can't be one of these. */
export const RESERVED_LIST_SLUGS = ["all", "saved"] as const;

export const MAX_LIST_SLUG = 60;

/**
 * A list's slug: its name lowercased, with every run of other characters
 * turned into one hyphen ("Backend shortlist" → "backend-shortlist").
 * Letters (with their combining marks, e.g. Devanagari vowel signs) and
 * digits in any script are kept. The migration backfilled existing lists
 * with the same rule. Empty when the name has neither.
 */
export function slugifyListName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LIST_SLUG)
    .replace(/-+$/, "");
}

export const isReservedListSlug = (slug: string) =>
  (RESERVED_LIST_SLUGS as readonly string[]).includes(slug);

/** A talent list's tab: `?tab=<slug>`. */
export const talentListPath = (slug: string) =>
  `/company/profiles?tab=${encodeURIComponent(slug)}`;

/**
 * The active tab from the URL: "saved", one of the company's list slugs, or
 * "all" for anything else (including a list that was renamed or deleted).
 */
export function activeTabFrom(
  searchParams: Pick<URLSearchParams, "get">,
  talentLists: Pick<TalentListTab, "slug">[] = [],
): string {
  const tab = searchParams.get("tab");
  if (tab === "saved") return "saved";
  if (tab && talentLists.some((l) => l.slug === tab)) return tab;
  return "all";
}
