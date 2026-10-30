const SEARCH_MAX_LENGTH = 100;

/**
 * Makes a search box value safe inside a PostgREST `or()` filter: drops the
 * characters that would end the quoted value or change the filter (`,()"\`)
 * and the ilike wildcards (`%`, `*`, `_`), collapses whitespace and caps it.
 */
export function sanitizeSearchTerm(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/[,()"\%*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
}
