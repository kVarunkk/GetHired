// Client-safe. The only filter My Jobs has: a keyword over title and company
// (AT-REQ-020), the same in both views and both tabs.

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Whether every word of `q` appears in the job title or company. A blank `q` matches everything. */
export function matchesKeyword(item: { jobTitle: string; companyName: string }, q: string | null | undefined): boolean {
  const words = normalize(q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(`${item.jobTitle} ${item.companyName}`);
  return words.every((word) => haystack.includes(word));
}

export const filterByKeyword = <T extends { jobTitle: string; companyName: string }>(items: T[], q: string | null | undefined) =>
  items.filter((item) => matchesKeyword(item, q));
